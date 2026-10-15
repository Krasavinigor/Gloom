import type { Knex } from 'knex';
import type { RecognitionProposal } from '../features/recognition/schema';
import type { InternalOperation, TerminalStatus } from '../server/operations/schema';
import { recognitionPricing, recognitionUsageCostMicroUsd } from '../server/recognition/pricing';
import type { RecognitionUsage } from '../server/recognition/pricing';

type Completion = {
  status: TerminalStatus; errorCode?: string; actualCostMicroUsd?: number;
  requestId?: string; responseId?: string; now?: Date;
  usage?: RecognitionUsage;
};
export type RecognitionProviderResult = {
  proposal: RecognitionProposal | null; usage: RecognitionUsage | null;
  requestId: string | null; responseId: string | null; errorCode?: string;
};
export type RecognitionWorkerDependencies = {
  workerId: string;
  repository: {
    claim(workerId: string, options: { now: Date; leaseMs: number }): Promise<InternalOperation | null>;
    markDispatched(id: string, workerId: string, options: {
      now: Date; clock: () => Date; validate: (transaction: Knex.Transaction) => Promise<boolean>;
    }): Promise<boolean>;
    finish(id: string, completion: Completion, publish?: (transaction: Knex.Transaction) => Promise<boolean | void>): Promise<unknown>;
  };
  context: {
    load(operation: InternalOperation): Promise<Buffer | null>;
    isCurrent(operation: InternalOperation): Promise<boolean>;
    canDispatch(transaction: Knex.Transaction, operation: InternalOperation): Promise<boolean>;
    publish(transaction: Knex.Transaction, operation: InternalOperation, proposal: RecognitionProposal): Promise<boolean>;
  };
  provider(input: { photo: Buffer; signal: AbortSignal }): Promise<RecognitionProviderResult>;
  signal?: AbortSignal;
  now?: () => Date;
};

function resultMetadata(result: RecognitionProviderResult) {
  return {
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(result.responseId ? { responseId: result.responseId } : {}),
  };
}

async function markCurrent(deps: RecognitionWorkerDependencies, operation: InternalOperation, now: () => Date) {
  let unavailable = false;
  const marked = await deps.repository.markDispatched(operation.id, deps.workerId, {
    now: now(), clock: now,
    validate: async transaction => {
      const current = await deps.context.canDispatch(transaction, operation);
      unavailable = !current;
      return current;
    },
  });
  if (!marked && unavailable) {
    await deps.repository.finish(operation.id, { status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE', now: now() });
  }
  return marked;
}

async function dispatch(deps: RecognitionWorkerDependencies, photo: Buffer, remainingMs: number) {
  const controller = new AbortController();
  const stop = () => controller.abort('WORKER_STOPPED');
  const timer = setTimeout(() => controller.abort('DEADLINE_EXCEEDED'), remainingMs);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('Recognition request aborted')), { once: true });
  });
  deps.signal?.addEventListener('abort', stop, { once: true });
  if (deps.signal?.aborted) stop();
  try {
    const request = controller.signal.aborted
      ? Promise.reject(new Error('Recognition request aborted'))
      : deps.provider({ photo, signal: controller.signal });
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', stop);
  }
}

async function runDispatched(deps: RecognitionWorkerDependencies, operation: InternalOperation, photo: Buffer, now: () => Date) {
  let result: RecognitionProviderResult;
  try {
    result = await dispatch(deps, photo, Math.max(1, Date.parse(operation.deadlineAt) - +now()));
  } catch (error) {
    const stopped = deps.signal?.aborted;
    const expired = Date.parse(operation.deadlineAt) <= +now();
    // Deadline races also terminate a non-cooperative transport; no new provider request is made.
    const timeout = !stopped && (expired || (error instanceof Error && error.message === 'Recognition request aborted'));
    const requestId = error instanceof Error && 'requestId' in error && typeof error.requestId === 'string' ? error.requestId : undefined;
    await deps.repository.finish(operation.id, {
      status: stopped ? 'interrupted' : timeout ? 'timed_out' : 'failed',
      errorCode: stopped ? 'WORKER_STOPPED' : timeout ? 'DEADLINE_EXCEEDED' : 'PROVIDER_ERROR',
      ...(requestId ? { requestId } : {}), now: now(),
    });
    return;
  }
  let actualCostMicroUsd: number;
  try {
    if (!result.usage) throw new Error('Usage missing');
    actualCostMicroUsd = recognitionUsageCostMicroUsd(result.usage);
  } catch {
    await deps.repository.finish(operation.id, { status: 'failed', errorCode: 'USAGE_UNAVAILABLE', ...resultMetadata(result), now: now() });
    return;
  }
  const completion = { actualCostMicroUsd, usage: result.usage!, ...resultMetadata(result), now: now() };
  if (!result.proposal) {
    await deps.repository.finish(operation.id, { ...completion, status: 'failed', errorCode: result.errorCode ?? 'invalid_output' });
    return;
  }
  const proposal = result.proposal;
  await deps.repository.finish(operation.id, { ...completion, status: 'succeeded' },
    transaction => deps.context.publish(transaction, operation, proposal));
}

/** One leased task. Only an explicitly admitted operation can dispatch provider I/O. */
export async function runRecognitionOnce(deps: RecognitionWorkerDependencies): Promise<boolean> {
  if (deps.signal?.aborted) return false;
  const now = deps.now ?? (() => new Date());
  const operation = await deps.repository.claim(deps.workerId, { now: now(), leaseMs: 45_000 });
  if (!operation) return false;
  if (operation.model !== recognitionPricing.model || operation.pricingRevision !== recognitionPricing.revision) {
    await deps.repository.finish(operation.id, { status: 'failed', errorCode: 'PRICING_CHANGED', now: now() });
    return true;
  }
  if (Date.parse(operation.deadlineAt) <= +now()) {
    await deps.repository.finish(operation.id, { status: 'timed_out', errorCode: 'DEADLINE_EXCEEDED', now: now() });
    return true;
  }
  let photo: Buffer | null;
  try {
    photo = operation.kind === 'recognition' ? await deps.context.load(operation) : null;
  } catch {
    await deps.repository.finish(operation.id, { status: 'failed', errorCode: 'PHOTO_UNAVAILABLE', now: now() });
    return true;
  }
  if (!photo || !await deps.context.isCurrent(operation)) {
    await deps.repository.finish(operation.id, { status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE', now: now() });
    return true;
  }
  if (deps.signal?.aborted || Date.parse(operation.deadlineAt) <= +now()) {
    const stopped = deps.signal?.aborted;
    await deps.repository.finish(operation.id, { status: stopped ? 'interrupted' : 'timed_out', errorCode: stopped ? 'WORKER_STOPPED' : 'DEADLINE_EXCEEDED', now: now() });
    return true;
  }
  // A failed/uncertain dispatch-marker commit must propagate: never risk a replay or a release.
  if (!await markCurrent(deps, operation, now)) return true;
  await runDispatched(deps, operation, photo, now);
  return true;
}
