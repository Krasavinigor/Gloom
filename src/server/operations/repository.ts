import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { ApiError } from '../http/api-error';
import {
  admissionSchema, budgetMonth, isTerminalStatus, MONTH_LIMIT_MICRO_USD,
  MONTH_WARNING_MICRO_USD, OPERATION_CHANNEL,
  type Admission, type BudgetSnapshot, type InternalOperation, type OperationSnapshot,
  type OperationStatus, type SendState, type SettlementState, type TerminalStatus,
} from './schema';

interface Row {
  id: string; kind: Admission['kind']; target_id: string; idempotency_key: string;
  payload_hash: string; payload: Record<string, unknown> | null;
  model: string; pricing_revision: string; admission_month: string;
  status: OperationStatus; status_revision: number; send_state: SendState;
  error_code: string | null; created_at: Date; deadline_at: Date;
  lease_owner: string | null; lease_expires_at: Date | null; attempts: number;
  updated_at: Date; dispatch_at: Date | null; request_id: string | null; response_id: string | null; result: unknown;
}
interface Ledger {
  operation_id: string; admission_month: string; settlement_state: SettlementState;
  model: string; pricing_revision: string; settled_at: Date | null; usage: unknown; reconciliation_reference: string | null;
  reserve_micro_usd: string | number; confirmed_micro_usd: string | number | null;
}
interface Month {
  month: string; limit_micro_usd: string | number; confirmed_cost: string | number;
  active_reserved: string | number; unknown_reserved: string | number;
}
export interface FinishInput {
  status: TerminalStatus;
  actualCostMicroUsd?: number;
  errorCode?: string;
  result?: unknown;
  requestId?: string;
  responseId?: string;
  now?: Date;
  usage?: UsageMetadata;
}
const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().nullable(), cacheWriteTokens: z.number().int().nonnegative().nullable(),
  serviceTier: z.string().max(100).nullable().optional(),
});
type UsageMetadata = z.infer<typeof usageSchema>;
const uuid = z.uuid();
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const unknownOperation = () => new ApiError('OPERATION_NOT_FOUND', 404, 'AI-задача не найдена.');
const conflicting = () => new ApiError('OPERATION_CONFLICT', 409, 'Запрос уже использован с другими данными.');
const snapshot = (row: Row, ledger: Ledger): OperationSnapshot => ({
  id: row.id, kind: row.kind, targetId: row.target_id, status: row.status,
  statusRevision: row.status_revision, sendState: row.send_state,
  settlementState: ledger.settlement_state, errorCode: row.error_code,
  createdAt: row.created_at.toISOString(), deadlineAt: row.deadline_at.toISOString(),
});
const internal = (row: Row, ledger: Ledger): InternalOperation => ({
  ...snapshot(row, ledger), payload: row.payload, model: row.model,
  pricingRevision: row.pricing_revision, admissionMonth: row.admission_month,
  reserveMicroUsd: Number(ledger.reserve_micro_usd), leaseOwner: row.lease_owner,
  leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null, attempts: row.attempts,
});
const asBudget = (row: Month): BudgetSnapshot => {
  const used = Number(row.confirmed_cost) + Number(row.active_reserved) + Number(row.unknown_reserved);
  return { month: row.month, limitMicroUsd: Number(row.limit_micro_usd),
    confirmedCostMicroUsd: Number(row.confirmed_cost), activeReservedMicroUsd: Number(row.active_reserved),
    unknownReservedMicroUsd: Number(row.unknown_reserved), remainingMicroUsd: Math.max(0, Number(row.limit_micro_usd) - used),
    warning: used >= MONTH_WARNING_MICRO_USD };
};

export function createOperationsRepository(database: Knex) {
  const getLedger = async (trx: Knex, id: string) => {
    const ledger = await trx<Ledger>('ai_cost_ledger').where({ operation_id: id }).first();
    if (!ledger) throw new Error('AI operation ledger is missing');
    return ledger;
  };
  const notify = (trx: Knex.Transaction, row: Row) =>
    trx.raw('SELECT pg_notify(?, ?)', [OPERATION_CHANNEL, JSON.stringify({ operationId: row.id, statusRevision: row.status_revision })]);
  async function lockMonth(trx: Knex.Transaction, month: string): Promise<Month> {
    await trx('ai_budget_months').insert({ month }).onConflict('month').ignore();
    return (await trx<Month>('ai_budget_months').where({ month }).forUpdate().first())!;
  }
  async function readOperation(id: string): Promise<Row & Ledger> {
    const row = await database('ai_operations as operation')
      .join('ai_cost_ledger as ledger', 'ledger.operation_id', 'operation.id')
      .where('operation.id', uuid.parse(id))
      .select('operation.*', 'ledger.settlement_state', 'ledger.reserve_micro_usd', 'ledger.confirmed_micro_usd')
      .first<Row & Ledger>();
    if (!row) throw unknownOperation();
    return row;
  }
  async function get(id: string): Promise<OperationSnapshot> {
    const row = await readOperation(id);
    return snapshot(row, row);
  }
  async function getInternal(id: string): Promise<InternalOperation> {
    const row = await readOperation(id);
    return internal(row, row);
  }
  async function snapshots(ids: readonly string[]): Promise<OperationSnapshot[]> {
    const valid = z.array(uuid).max(20).parse(ids);
    // One statement gives status and settlement from the same committed snapshot.
    const rows = await database('ai_operations as operation')
      .join('ai_cost_ledger as ledger', 'ledger.operation_id', 'operation.id')
      .whereIn('operation.id', valid).select('operation.*', 'ledger.settlement_state');
    return rows.map((row) => snapshot(row, row));
  }
  async function budget(month = budgetMonth()): Promise<BudgetSnapshot> {
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(month);
    const row = await database<Month>('ai_budget_months').where({ month }).first();
    return asBudget(row ?? { month, limit_micro_usd: MONTH_LIMIT_MICRO_USD, confirmed_cost: 0, active_reserved: 0, unknown_reserved: 0 });
  }
  async function admit(input: Admission, options: {
    now?: Date; deadlineAt?: Date;
    validate?: (trx: Knex.Transaction, operationId: string) => Promise<void>;
  } = {}): Promise<OperationSnapshot> {
    const data = admissionSchema.parse(input);
    const now = options.now ?? new Date();
    const deadline = options.deadlineAt ?? new Date(now.getTime() + 30_000);
    if (deadline.getTime() <= now.getTime() || deadline.getTime() > now.getTime() + 30_000) {
      throw new ApiError('INVALID_DEADLINE', 400, 'Неверный срок выполнения AI-задачи.');
    }
    return database.transaction(async (trx) => {
      // Serializes only admissions, including retries crossing UTC midnight.
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', ['wardrobe-ai-admission']);
      const existing = await trx<Row>('ai_operations').where({ idempotency_key: data.idempotencyKey }).first();
      if (existing) {
        if (existing.kind !== data.kind || existing.target_id !== data.targetId || existing.payload_hash !== data.payloadHash) throw conflicting();
        return snapshot(existing, await getLedger(trx, existing.id));
      }
      const active = await trx<Row>('ai_operations').where({ kind: data.kind, target_id: data.targetId }).whereIn('status', ['queued', 'running']).first();
      if (active) return snapshot(active, await getLedger(trx, active.id));
      const month = budgetMonth(now);
      const budgetRow = await lockMonth(trx, month);
      if (asBudget(budgetRow).remainingMicroUsd < data.reserveMicroUsd) {
        throw new ApiError('AI_BUDGET_EXCEEDED', 429, 'Месячный бюджет AI исчерпан. Карточку можно заполнить вручную.');
      }
      const id = randomUUID();
      const [row] = await trx<Row>('ai_operations').insert({
        id, kind: data.kind, target_id: data.targetId, idempotency_key: data.idempotencyKey,
        payload_hash: data.payloadHash, payload: data.payload, model: data.model,
        pricing_revision: data.pricingRevision, admission_month: month,
        deadline_at: deadline, created_at: now, updated_at: now,
      }).returning('*');
      const [ledger] = await trx<Ledger>('ai_cost_ledger').insert({
        operation_id: id, admission_month: month, model: data.model, pricing_revision: data.pricingRevision,
        reserve_micro_usd: data.reserveMicroUsd,
      }).returning('*');
      await trx('ai_budget_months').where({ month }).increment('active_reserved', data.reserveMicroUsd);
      await options.validate?.(trx, id);
      await notify(trx, row);
      return snapshot(row, ledger);
    });
  }
  async function claim(workerId: string, options: { now?: Date; leaseMs?: number; operationId?: string } = {}): Promise<InternalOperation | null> {
    z.string().min(1).max(200).parse(workerId);
    const now = options.now ?? new Date();
    const leaseMs = z.number().int().min(1).max(60_000).parse(options.leaseMs ?? 35_000);
    return database.transaction(async (trx) => {
      const query = trx<Row>('ai_operations').where({ status: 'queued', send_state: 'not_sent' })
        .where('kind', 'recognition').where('deadline_at', '>', now)
        .orderBy('created_at').forUpdate().skipLocked();
      if (options.operationId) query.where({ id: uuid.parse(options.operationId) });
      const row = await query.first();
      if (!row) return null;
      const [updated] = await trx<Row>('ai_operations').where({ id: row.id }).update({
        status: 'running', status_revision: row.status_revision + 1, lease_owner: workerId,
        lease_expires_at: new Date(now.getTime() + leaseMs), attempts: row.attempts + 1, updated_at: now,
      }).returning('*');
      await notify(trx, updated);
      return internal(updated, await getLedger(trx, row.id));
    });
  }
  async function markDispatched(id: string, workerId: string, options: {
    now?: Date; clock?: () => Date; validate?: (transaction: Knex.Transaction) => Promise<boolean>;
  } = {}): Promise<boolean> {
    uuid.parse(id);
    const now = options.clock?.() ?? options.now ?? new Date();
    return database.transaction(async (trx) => {
      const row = await trx<Row>('ai_operations').where({ id }).forUpdate().first();
      if (!row || row.status !== 'running' || row.send_state !== 'not_sent' || row.lease_owner !== workerId ||
        !row.lease_expires_at || row.lease_expires_at <= now || row.deadline_at <= now) return false;
      if (options.validate && !await options.validate(trx)) return false;
      const dispatchedAt = options.clock?.() ?? options.now ?? new Date();
      if (row.deadline_at <= dispatchedAt || row.lease_expires_at <= dispatchedAt) return false;
      const [updated] = await trx<Row>('ai_operations').where({ id }).update({
        send_state: 'sent_unknown', dispatch_at: dispatchedAt, status_revision: row.status_revision + 1, updated_at: dispatchedAt,
      }).returning('*');
      await notify(trx, updated);
      return true;
    });
  }
  async function settle(trx: Knex.Transaction, ledger: Ledger, state: SettlementState, actual: number | undefined, now: Date): Promise<Ledger> {
    await lockMonth(trx, ledger.admission_month);
    const previousColumn = ledger.settlement_state === 'reserved' ? 'active_reserved' : ledger.settlement_state === 'unknown' ? 'unknown_reserved' : null;
    if (previousColumn) await trx('ai_budget_months').where({ month: ledger.admission_month }).decrement(previousColumn, Number(ledger.reserve_micro_usd));
    if (state === 'unknown') await trx('ai_budget_months').where({ month: ledger.admission_month }).increment('unknown_reserved', Number(ledger.reserve_micro_usd));
    if (state === 'confirmed') await trx('ai_budget_months').where({ month: ledger.admission_month }).increment('confirmed_cost', actual!);
    const [updated] = await trx<Ledger>('ai_cost_ledger').where({ operation_id: ledger.operation_id }).update({
      settlement_state: state, confirmed_micro_usd: actual ?? null, settled_at: now,
    }).returning('*');
    return updated;
  }
  async function finish(id: string, input: FinishInput, publish?: (trx: Knex.Transaction) => Promise<boolean | void>): Promise<OperationSnapshot> {
    uuid.parse(id);
    const status = z.enum(['succeeded', 'failed', 'timed_out', 'interrupted']).parse(input.status);
    if (input.actualCostMicroUsd !== undefined) money.parse(input.actualCostMicroUsd);
    const usage = input.usage === undefined ? undefined : usageSchema.parse(input.usage);
    const now = input.now ?? new Date();
    return database.transaction(async (trx) => {
      const row = await trx<Row>('ai_operations').where({ id }).forUpdate().first();
      if (!row) throw unknownOperation();
      const ledger = await getLedger(trx, id);
      if (isTerminalStatus(row.status)) {
        if (ledger.settlement_state !== 'unknown' || input.actualCostMicroUsd === undefined) return snapshot(row, ledger);
        const settled = await settle(trx, ledger, 'confirmed', input.actualCostMicroUsd, now);
        const [updated] = await trx<Row>('ai_operations').where({ id }).update({
          send_state: 'response_received', request_id: input.requestId ?? null,
          response_id: input.responseId ?? null, status_revision: row.status_revision + 1, updated_at: now,
        }).returning('*');
        if (usage) await trx('ai_cost_ledger').where({ operation_id: id }).update({ usage });
        await notify(trx, updated);
        return snapshot(updated, settled);
      }
      if (status === 'succeeded' && (row.send_state === 'not_sent' || input.actualCostMicroUsd === undefined)) {
        throw new Error('Successful AI operation requires dispatch and confirmed usage');
      }
      if (row.send_state === 'not_sent' && input.actualCostMicroUsd !== undefined) throw new Error('Unsent AI operation cannot have usage');
      const settlement: SettlementState = input.actualCostMicroUsd !== undefined ? 'confirmed' : row.send_state === 'not_sent' ? 'released' : 'unknown';
      const updatedLedger = await settle(trx, ledger, settlement, input.actualCostMicroUsd, now);
      if (usage) await trx('ai_cost_ledger').where({ operation_id: id }).update({ usage });
      const published = status === 'succeeded' && publish ? await publish(trx) : undefined;
      const [updated] = await trx<Row>('ai_operations').where({ id }).update({
        status: published === false ? 'failed' : status,
        error_code: published === false ? 'TARGET_UNAVAILABLE' : input.errorCode ?? null,
        send_state: input.actualCostMicroUsd !== undefined ? 'response_received' : row.send_state,
        request_id: input.requestId ?? null, response_id: input.responseId ?? null,
        payload: null, result: null, lease_owner: null, lease_expires_at: null,
        status_revision: row.status_revision + 1, updated_at: now,
      }).returning('*');
      await notify(trx, updated);
      return snapshot(updated, updatedLedger);
    });
  }
  async function recover(now = new Date()): Promise<number> {
    const rows = await database<Row>('ai_operations').whereIn('status', ['queued', 'running'])
      .andWhere((query) => query.where('deadline_at', '<=', now).orWhere('lease_expires_at', '<=', now));
    let recovered = 0;
    for (const candidate of rows) {
      await database.transaction(async (trx) => {
        const row = await trx<Row>('ai_operations').where({ id: candidate.id }).forUpdate().first();
        if (!row || isTerminalStatus(row.status)) return;
        if (row.deadline_at > now && (!row.lease_expires_at || row.lease_expires_at > now)) return;
        const requeue = row.send_state === 'not_sent' && row.deadline_at > now;
        const ledger = await getLedger(trx, row.id);
        if (!requeue) await settle(trx, ledger, row.send_state === 'not_sent' ? 'released' : 'unknown', undefined, now);
        const [updated] = await trx<Row>('ai_operations').where({ id: row.id }).update({
          status: requeue ? 'queued' : row.send_state === 'not_sent' ? 'timed_out' : 'interrupted',
          error_code: requeue ? null : row.send_state === 'not_sent' ? 'DEADLINE_EXCEEDED' : 'PROVIDER_OUTCOME_UNKNOWN',
          lease_owner: null, lease_expires_at: null,
          ...(requeue ? {} : { payload: null, result: null }),
          status_revision: row.status_revision + 1, updated_at: now,
        }).returning('*');
        await notify(trx, updated);
        recovered += 1;
      });
    }
    return recovered;
  }
  async function reconcile(id: string, actualCostMicroUsd: number, evidence?: string): Promise<OperationSnapshot> {
    uuid.parse(id); money.parse(actualCostMicroUsd);
    if (evidence !== undefined) z.string().trim().min(1).max(500).parse(evidence);
    return database.transaction(async (trx) => {
      const row = await trx<Row>('ai_operations').where({ id }).forUpdate().first();
      if (!row) throw unknownOperation();
      const ledger = await getLedger(trx, id);
      if (ledger.settlement_state === 'confirmed' && Number(ledger.confirmed_micro_usd) === actualCostMicroUsd) return snapshot(row, ledger);
      if (ledger.settlement_state !== 'unknown' || !isTerminalStatus(row.status)) throw conflicting();
      const settled = await settle(trx, ledger, 'confirmed', actualCostMicroUsd, new Date());
      if (evidence) await trx('ai_cost_ledger').where({ operation_id: id }).update({ reconciliation_reference: evidence });
      const [updated] = await trx<Row>('ai_operations').where({ id }).update({ status_revision: row.status_revision + 1, updated_at: trx.fn.now() }).returning('*');
      await notify(trx, updated);
      return snapshot(updated, settled);
    });
  }
  return { admit, get, snapshots, getInternal, budget, claim, markDispatched, finish, recover, reconcile };
}
export type OperationsRepository = ReturnType<typeof createOperationsRepository>;
