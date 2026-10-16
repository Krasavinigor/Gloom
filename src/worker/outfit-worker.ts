import type { Knex } from 'knex';
import { selectBackground } from '../features/backgrounds/catalog';
import { validateOutfitSuggestions } from '../features/outfits/validation';
import type { ValidatedOutfit } from '../features/outfits/schema';
import type { InternalOperation } from '../server/operations/schema';
import type { FinishInput } from '../server/operations/repository';
import { outfitPricing, outfitUsageCostMicroUsd } from '../server/outfits/pricing';
import { preflightOutfitSnapshot, type OutfitProviderSnapshot, type OutfitResult } from '../server/outfits/provider';
import { parseOutfitOperationPayload } from '../server/outfits/repository';

export type OutfitWorkerDependencies = {
  workerId: string;
  repository: {
    claim(workerId: string, options: { now: Date; leaseMs: number; kinds: readonly ['outfits'] }): Promise<InternalOperation | null>;
    markDispatched(id: string, workerId: string, options: { now: Date; clock: () => Date; validate: (transaction: Knex.Transaction) => Promise<boolean> }): Promise<boolean>;
    finish(id: string, completion: FinishInput, publish?: (transaction: Knex.Transaction) => Promise<boolean | void>): Promise<unknown>;
  };
  context: {
    canDispatch(transaction: Knex.Transaction, operation: InternalOperation): Promise<boolean>;
    publish(transaction: Knex.Transaction, operation: InternalOperation, result: { outfits: ValidatedOutfit[]; backgroundPresetId: string }): Promise<boolean>;
  };
  provider(input: { snapshot: OutfitProviderSnapshot; signal: AbortSignal }): Promise<OutfitResult>;
  signal?: AbortSignal;
  now?: () => Date;
};

async function markCurrent(deps: OutfitWorkerDependencies, operation: InternalOperation, now: () => Date) {
  let unavailable = false;
  const marked = await deps.repository.markDispatched(operation.id, deps.workerId, {
    now: now(), clock: now, validate: async transaction => {
      const current = await deps.context.canDispatch(transaction, operation);
      unavailable = !current;
      return current;
    },
  });
  if (!marked && unavailable) await deps.repository.finish(operation.id, { status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE', now: now() });
  return marked;
}

async function dispatch(deps: OutfitWorkerDependencies, snapshot: OutfitProviderSnapshot, remainingMs: number) {
  const controller = new AbortController();
  const stop = () => controller.abort('WORKER_STOPPED');
  const timer = setTimeout(() => controller.abort('DEADLINE_EXCEEDED'), remainingMs);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('Outfit request aborted')), { once: true });
  });
  deps.signal?.addEventListener('abort', stop, { once: true });
  if (deps.signal?.aborted) stop();
  try {
    const request = controller.signal.aborted ? Promise.reject(new Error('Outfit request aborted')) : deps.provider({ snapshot, signal: controller.signal });
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', stop);
  }
}

async function runDispatched(deps: OutfitWorkerDependencies, operation: InternalOperation, snapshot: OutfitProviderSnapshot, now: () => Date) {
  let result: OutfitResult;
  try {
    result = await dispatch(deps, snapshot, Math.max(1, Date.parse(operation.deadlineAt) - +now()));
  } catch (error) {
    const stopped = deps.signal?.aborted;
    const timeout = !stopped && (Date.parse(operation.deadlineAt) <= +now() || (error instanceof Error && error.message === 'Outfit request aborted'));
    const requestId = error instanceof Error && 'requestId' in error && typeof error.requestId === 'string' ? error.requestId : undefined;
    await deps.repository.finish(operation.id, { status: stopped ? 'interrupted' : timeout ? 'timed_out' : 'failed',
      errorCode: stopped ? 'WORKER_STOPPED' : timeout ? 'DEADLINE_EXCEEDED' : 'PROVIDER_ERROR', ...(requestId ? { requestId } : {}), now: now() });
    return;
  }
  const metadata = { ...(result.requestId ? { requestId: result.requestId } : {}), ...(result.responseId ? { responseId: result.responseId } : {}) };
  let actualCostMicroUsd: number;
  try {
    if (!result.usage) throw new Error('Usage missing');
    actualCostMicroUsd = outfitUsageCostMicroUsd(result.usage);
  } catch {
    await deps.repository.finish(operation.id, { status: 'failed', errorCode: 'USAGE_UNAVAILABLE', ...metadata, now: now() });
    return;
  }
  const completion = { actualCostMicroUsd, usage: result.usage!, ...metadata, now: now() };
  if (deps.signal?.aborted || Date.parse(operation.deadlineAt) <= +now()) {
    const stopped = deps.signal?.aborted;
    await deps.repository.finish(operation.id, { ...completion,
      status: stopped ? 'interrupted' : 'timed_out',
      errorCode: stopped ? 'WORKER_STOPPED' : 'DEADLINE_EXCEEDED',
    });
    return;
  }
  const outfits = result.suggestions ? validateOutfitSuggestions(result.suggestions, snapshot.garments, snapshot.weather) : [];
  if (!outfits.length) {
    await deps.repository.finish(operation.id, { ...completion, status: 'failed', errorCode: result.errorCode ?? 'INVALID_AI_RESPONSE' });
    return;
  }
  const backgroundPresetId = selectBackground(snapshot.weather);
  await deps.repository.finish(operation.id, { ...completion, status: 'succeeded' }, transaction => deps.context.publish(transaction, operation, { outfits, backgroundPresetId }));
}

/** One explicitly admitted outfit operation; an uncertain dispatch is never replayed. */
export async function runOutfitOnce(deps: OutfitWorkerDependencies): Promise<boolean> {
  if (deps.signal?.aborted) return false;
  const now = deps.now ?? (() => new Date());
  const operation = await deps.repository.claim(deps.workerId, { now: now(), leaseMs: 45_000, kinds: ['outfits'] });
  if (!operation) return false;
  if (operation.model !== outfitPricing.model || operation.pricingRevision !== outfitPricing.revision) {
    await deps.repository.finish(operation.id, { status: 'failed', errorCode: 'PRICING_CHANGED', now: now() }); return true;
  }
  if (Date.parse(operation.deadlineAt) <= +now()) {
    await deps.repository.finish(operation.id, { status: 'timed_out', errorCode: 'DEADLINE_EXCEEDED', now: now() }); return true;
  }
  let payload: ReturnType<typeof parseOutfitOperationPayload>;
  try {
    if (operation.kind !== 'outfits') throw new Error('Wrong operation kind');
    payload = parseOutfitOperationPayload(operation.payload);
    if (!payload) throw new Error('Missing snapshot');
    preflightOutfitSnapshot(payload.snapshot);
  } catch {
    await deps.repository.finish(operation.id, { status: 'failed', errorCode: 'INVALID_OPERATION_PAYLOAD', now: now() }); return true;
  }
  if (deps.signal?.aborted) {
    await deps.repository.finish(operation.id, { status: 'interrupted', errorCode: 'WORKER_STOPPED', now: now() }); return true;
  }
  // Propagate an uncertain dispatch-marker commit without releasing or retrying it.
  if (!await markCurrent(deps, operation, now)) return true;
  await runDispatched(deps, operation, payload.snapshot, now);
  return true;
}
