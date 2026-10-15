import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createOperationsRepository } from '../../src/server/operations/repository';
import { createPgOperationEventHub, type OperationEventHub } from '../../src/server/operations/events';
import { createOperationEventStream } from '../../src/server/operations/event-stream';
import { OPERATION_CHANNEL, operationSnapshotSchema, type OperationSnapshot } from '../../src/server/operations/schema';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `events_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!url)('PostgreSQL operation event delivery', () => {
  const admin = url ? createDatabase(url) : null;
  const db = url ? createDatabase(url, schema) : null;
  const repository = db ? createOperationsRepository(db) : null;
  const hubs: OperationEventHub[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  beforeAll(async () => { await admin!.schema.createSchema(schema); await migrateDatabase(db!, schema); });
  beforeEach(async () => {
    await db!('ai_cost_ledger').delete(); await db!('ai_operations').delete(); await db!('ai_budget_months').delete();
  });
  afterEach(async () => {
    await Promise.all(readers.splice(0).map((reader) => reader.cancel().catch(() => {})));
    await Promise.all(hubs.splice(0).map((hub) => hub.dispose()));
  });
  afterAll(async () => { await db!.destroy(); await admin!.schema.dropSchemaIfExists(schema, true); await admin!.destroy(); });
  const admit = () => repository!.admit({
    kind: 'recognition', targetId: randomUUID(), idempotencyKey: randomUUID(),
    payloadHash: 'a'.repeat(64), payload: { fixture: true }, model: 'synthetic-test-model',
    pricingRevision: 'synthetic-test-prices', reserveMicroUsd: 100,
  });
  function hub() {
    const value = createPgOperationEventHub({ connectionString: url! }); hubs.push(value); return value;
  }
  function watch(id: string, events: OperationEventHub) {
    const reader = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: repository!.snapshots, hub: events }).getReader();
    readers.push(reader); return reader;
  }
  async function next(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<OperationSnapshot> {
    const result = await reader.read();
    expect(result.done).toBe(false);
    const chunk = new TextDecoder().decode(result.value);
    expect(chunk).toContain('event: operation\n');
    return operationSnapshotSchema.parse(JSON.parse(chunk.split('\ndata: ')[1].trim()));
  }

  it('reads initial queued state and committed claim/dispatch/completion through real LISTEN', async () => {
    const operation = await admit(); const reader = watch(operation.id, hub());
    expect(await next(reader)).toMatchObject({ id: operation.id, status: 'queued', statusRevision: 1 });
    await repository!.claim('event-test-worker');
    expect(await next(reader)).toMatchObject({ id: operation.id, status: 'running', statusRevision: 2 });
    expect(await repository!.markDispatched(operation.id, 'event-test-worker')).toBe(true);
    expect(await next(reader)).toMatchObject({ status: 'running', sendState: 'sent_unknown', statusRevision: 3 });
    // Synthetic accounting exercises the transaction boundary; no provider is contacted.
    await repository!.finish(operation.id, { status: 'succeeded', actualCostMicroUsd: 23 });
    expect(await next(reader)).toMatchObject({ status: 'succeeded', settlementState: 'confirmed', statusRevision: 4 });
    expect((await reader.read()).done).toBe(true);
  });

  it('fails a feed on dedicated connection disposal and recovers terminal state from a fresh snapshot', async () => {
    const operation = await admit(); const events = hub(); const reader = watch(operation.id, events);
    expect((await next(reader)).status).toBe('queued');
    const failure = expect(reader.read()).rejects.toThrow('Operation events unavailable.');
    await events.dispose(); await failure;
    await repository!.finish(operation.id, { status: 'failed', errorCode: 'SYNTHETIC_PRE_DISPATCH_FAILURE' });
    const recovered = watch(operation.id, hub());
    expect(await next(recovered)).toMatchObject({ status: 'failed', statusRevision: 2, settlementState: 'released' });
    expect((await recovered.read()).done).toBe(true);
  });

  it('delivers notifications after commit and suppresses notifications from rolled-back transactions', async () => {
    const operation = await admit(); const events = hub(); const reader = watch(operation.id, events);
    await next(reader);
    const changed = vi.fn(); const unsubscribe = events.subscribe({ onChange: changed, onUnavailable: vi.fn() });
    const trx = await db!.transaction();
    try {
      await trx('ai_operations').where({ id: operation.id }).update({ status: 'running', status_revision: 2 });
      await trx.raw('SELECT pg_notify(?, ?)', [OPERATION_CHANNEL, JSON.stringify({ operationId: operation.id, statusRevision: 2 })]);
      expect(changed).not.toHaveBeenCalled();
      expect((await repository!.get(operation.id)).status).toBe('queued');
      await trx.commit();
      expect(await next(reader)).toMatchObject({ status: 'running', statusRevision: 2 });
      expect(changed).toHaveBeenCalledWith([operation.id]);
    } finally { if (!trx.isCompleted()) await trx.rollback(); unsubscribe(); }
    const rolledBackEvents = vi.fn();
    const unsubscribeRollback = events.subscribe({ onChange: rolledBackEvents, onUnavailable: vi.fn() });
    const rolledBack = await db!.transaction();
    try {
      await rolledBack('ai_operations').where({ id: operation.id }).update({ status: 'failed', status_revision: 3 });
      await rolledBack.raw('SELECT pg_notify(?, ?)', [OPERATION_CHANNEL, JSON.stringify({ operationId: operation.id, statusRevision: 3 })]);
      await rolledBack.rollback();
    } finally { if (!rolledBack.isCompleted()) await rolledBack.rollback(); }
    // A committed sentinel is a delivery barrier after the rollback, without sleeping.
    const barrierId = randomUUID();
    await db!.raw('SELECT pg_notify(?, ?)', [OPERATION_CHANNEL, JSON.stringify({ operationId: barrierId, statusRevision: 1 })]);
    await vi.waitFor(() => expect(rolledBackEvents).toHaveBeenCalledWith([barrierId]));
    expect(rolledBackEvents.mock.calls.some(([ids]) => ids.includes(operation.id))).toBe(false);
    unsubscribeRollback();
    expect((await repository!.get(operation.id)).statusRevision).toBe(2);
    await repository!.finish(operation.id, { status: 'failed', errorCode: 'SYNTHETIC_FINISH' });
    expect(await next(reader)).toMatchObject({ status: 'failed', statusRevision: 3 });
    expect((await reader.read()).done).toBe(true);
  });
});
