import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createOperationsRepository } from '../../src/server/operations/repository';
import type { Admission } from '../../src/server/operations/schema';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `operations_test_${randomUUID().replaceAll('-', '')}`;
const admission = (overrides: Partial<Admission> = {}): Admission => ({
  kind: 'recognition', targetId: randomUUID(), idempotencyKey: randomUUID(),
  payloadHash: 'a'.repeat(64), payload: { draftId: randomUUID() },
  model: 'test-model', pricingRevision: 'test-prices', reserveMicroUsd: 100,
  ...overrides,
});

describe.skipIf(!url)('durable operations and money', () => {
  const admin = url ? createDatabase(url) : null;
  const db = url ? createDatabase(url, schema) : null;
  const repository = db ? createOperationsRepository(db) : null;
  beforeAll(async () => { await admin!.schema.createSchema(schema); await migrateDatabase(db!, schema); });
  beforeEach(async () => {
    await db!('ai_cost_ledger').delete(); await db!('ai_operations').delete(); await db!('ai_budget_months').delete();
  });
  afterAll(async () => { await db!.destroy(); await admin!.schema.dropSchemaIfExists(schema, true); await admin!.destroy(); });
  it('deduplicates admission, rejects changed payload and caps concurrent reservations', async () => {
    const input = admission({ reserveMicroUsd: 6_000_000 });
    const initial = await repository!.admit(input);
    expect(await repository!.admit(input)).toEqual(initial);
    await expect(repository!.admit({ ...input, payloadHash: 'b'.repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect((await repository!.admit({ ...admission(), targetId: input.targetId })).id).toBe(initial.id);
    const simultaneous = await Promise.allSettled([repository!.admit(admission({ reserveMicroUsd: 4_000_000 })), repository!.admit(admission({ reserveMicroUsd: 4_000_000 }))]);
    expect(simultaneous.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect((await repository!.budget()).remainingMicroUsd).toBe(0);
  });
  it('claims once, commits dispatch before provider work and settles against admission month', async () => {
    const now = new Date('2026-10-31T23:59:55Z');
    const op = await repository!.admit(admission(), { now });
    const claims = await Promise.all([repository!.claim('worker-one', { now }), repository!.claim('worker-two', { now })]);
    const claimed = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await repository!.markDispatched(op.id, claimed.leaseOwner!, { now })).toBe(true);
    expect(await repository!.markDispatched(op.id, claimed.leaseOwner!, { now })).toBe(false);
    const finished = await repository!.finish(op.id, { status: 'succeeded', actualCostMicroUsd: 35, requestId: 'req_test', now: new Date('2026-11-01T00:00:01Z') });
    expect(finished).toMatchObject({ status: 'succeeded', settlementState: 'confirmed', sendState: 'response_received', statusRevision: 4 });
    expect(await repository!.budget('2026-10')).toMatchObject({ confirmedCostMicroUsd: 35, activeReservedMicroUsd: 0 });
    expect(await repository!.budget('2026-11')).toMatchObject({ confirmedCostMicroUsd: 0 });
    expect((await repository!.getInternal(op.id)).payload).toBeNull();
  });
  it('retains unknown charges after a dispatched crash, never replays, and reconciles explicitly', async () => {
    const now = new Date();
    const op = await repository!.admit(admission(), { now });
    await repository!.claim('crashed', { now, leaseMs: 1 });
    await repository!.markDispatched(op.id, 'crashed', { now });
    await repository!.recover(new Date(now.getTime() + 100));
    expect(await repository!.get(op.id)).toMatchObject({ status: 'interrupted', settlementState: 'unknown' });
    expect(await repository!.claim('replacement')).toBeNull();
    expect(await repository!.budget()).toMatchObject({ unknownReservedMicroUsd: 100, activeReservedMicroUsd: 0 });
    await repository!.reconcile(op.id, 17);
    await repository!.reconcile(op.id, 17);
    expect(await repository!.budget()).toMatchObject({ unknownReservedMicroUsd: 0, confirmedCostMicroUsd: 17 });
    await expect(repository!.reconcile(op.id, 18)).rejects.toMatchObject({ status: 409 });
  });
  it('safely reclaims a pre-dispatch lease and releases an expired queue reservation', async () => {
    const now = new Date();
    const op = await repository!.admit(admission(), { now });
    await repository!.claim('first', { now, leaseMs: 1 });
    await repository!.recover(new Date(now.getTime() + 2));
    expect((await repository!.claim('second', { now: new Date(now.getTime() + 3) }))?.id).toBe(op.id);
    await repository!.recover(new Date(now.getTime() + 31_000));
    expect(await repository!.get(op.id)).toMatchObject({ status: 'timed_out', settlementState: 'released' });
    expect((await repository!.budget()).remainingMicroUsd).toBe(10_000_000);
  });
  it('publishes atomically, marks a vanished target failed and leaves its confirmed cost', async () => {
    const op = await repository!.admit(admission());
    await repository!.claim('worker'); await repository!.markDispatched(op.id, 'worker');
    await expect(repository!.finish(op.id, { status: 'succeeded', actualCostMicroUsd: 25 }, async () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await repository!.get(op.id)).status).toBe('running');
    expect(await repository!.finish(op.id, { status: 'succeeded', actualCostMicroUsd: 25 }, async () => false)).toMatchObject({ status: 'failed', errorCode: 'TARGET_UNAVAILABLE', settlementState: 'confirmed' });
    expect((await repository!.budget()).confirmedCostMicroUsd).toBe(25);
  });
  it('rolls back failed admission validation and omits private payload from public snapshots', async () => {
    const input = admission();
    await expect(repository!.admit(input, { validate: async () => { throw new Error('invalid draft'); } })).rejects.toThrow('invalid draft');
    expect(await db!('ai_operations').count('* as count').first()).toMatchObject({ count: '0' });
    expect((await repository!.budget()).activeReservedMicroUsd).toBe(0);
    const op = await repository!.admit(input);
    expect(await repository!.snapshots([op.id])).toEqual([op]);
    expect(await repository!.getInternal(op.id)).toMatchObject({ payload: input.payload });
    await expect(repository!.get(randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(repository!.getInternal(randomUUID())).rejects.toMatchObject({ status: 404 });
  });
  it('releases failures before dispatch, rejects impossible success and rejects wrong lease owners', async () => {
    const op = await repository!.admit(admission());
    await expect(repository!.finish(op.id, { status: 'succeeded', actualCostMicroUsd: 10 })).rejects.toThrow();
    await expect(repository!.finish(op.id, { status: 'failed', actualCostMicroUsd: 10 })).rejects.toThrow();
    expect(await repository!.markDispatched(op.id, 'absent')).toBe(false);
    await repository!.claim('owner');
    expect(await repository!.markDispatched(op.id, 'other')).toBe(false);
    const failed = await repository!.finish(op.id, { status: 'failed', errorCode: 'INVALID_DRAFT' });
    expect(failed).toMatchObject({ settlementState: 'released', errorCode: 'INVALID_DRAFT' });
    expect(await repository!.finish(op.id, { status: 'failed' })).toEqual(failed);
    await expect(repository!.reconcile(op.id, 0)).rejects.toMatchObject({ status: 409 });
    await expect(repository!.finish(randomUUID(), { status: 'failed' })).rejects.toMatchObject({ status: 404 });
    await expect(repository!.reconcile(randomUUID(), 1)).rejects.toMatchObject({ status: 404 });
  });
  it('settles late usage without publishing after recovery already finalized the task', async () => {
    const now = new Date();
    const op = await repository!.admit(admission(), { now });
    await repository!.claim('lost', { now, leaseMs: 1 });
    await repository!.markDispatched(op.id, 'lost', { now });
    await repository!.recover(new Date(now.getTime() + 5));
    let published = false;
    expect(await repository!.finish(op.id, { status: 'succeeded', actualCostMicroUsd: 16 }, async () => { published = true; })).toMatchObject({ status: 'interrupted', settlementState: 'confirmed', sendState: 'response_received' });
    expect(published).toBe(false);
    expect(await repository!.budget()).toMatchObject({ confirmedCostMicroUsd: 16, unknownReservedMicroUsd: 0 });
  });
  it('keeps chat out of the worker queue and applies the warning threshold', async () => {
    const op = await repository!.admit(admission({ kind: 'chat', payload: {}, reserveMicroUsd: 8_000_000 }));
    expect(await repository!.claim('worker')).toBeNull();
    expect(await repository!.budget()).toMatchObject({ warning: true, activeReservedMicroUsd: 8_000_000 });
    await repository!.finish(op.id, { status: 'failed' });
    await expect(repository!.admit(admission(), { deadlineAt: new Date(Date.now() - 1) })).rejects.toMatchObject({ status: 400 });
    await expect(repository!.admit(admission(), { deadlineAt: new Date(Date.now() + 40_000) })).rejects.toMatchObject({ status: 400 });
    await expect(repository!.budget('bad')).rejects.toThrow();
    await expect(repository!.snapshots([randomUUID(), 'bad'])).rejects.toThrow();
  });

  it('leaves future outfit jobs queued until an outfit dispatcher is implemented', async () => {
    const op = await repository!.admit(admission({ kind: 'outfits' }));
    expect(await repository!.claim('recognition-worker')).toBeNull();
    expect(await repository!.get(op.id)).toMatchObject({ status: 'queued', sendState: 'not_sent' });
  });

  it('allows a diagnostic worker to claim only its own operation', async () => {
    const personal = await repository!.admit(admission());
    const probe = await repository!.admit(admission());
    expect((await repository!.claim('probe', { operationId: probe.id }))?.id).toBe(probe.id);
    expect(await repository!.get(personal.id)).toMatchObject({ status: 'queued', sendState: 'not_sent' });
  });

  it('records verified usage and actual costs exceeding a reservation without losing the expense', async () => {
    const op = await repository!.admit(admission());
    await repository!.claim('worker'); await repository!.markDispatched(op.id, 'worker');
    const usage = { inputTokens: 200, outputTokens: 30, cachedInputTokens: 0, cacheWriteTokens: null, serviceTier: 'default' };
    await repository!.finish(op.id, { status: 'succeeded', actualCostMicroUsd: 150, usage });
    expect(await db!('ai_cost_ledger').where({ operation_id: op.id }).first()).toMatchObject({ confirmed_micro_usd: '150', usage });
    expect(await repository!.budget()).toMatchObject({ confirmedCostMicroUsd: 150, activeReservedMicroUsd: 0 });
  });

});
