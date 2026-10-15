import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { garmentFieldsSchema } from '../../src/features/wardrobe/schema';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { createOperationsRepository } from '../../src/server/operations/repository';
import { createRecognitionContext } from '../../src/server/recognition/context';
import { createRecognitionService } from '../../src/server/recognition/service';
import { createWardrobeRepository } from '../../src/server/wardrobe/repository';
import { runRecognitionOnce } from '../../src/worker/recognition-worker';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `recognition_dispatch_${randomUUID().replaceAll('-', '')}`;
const manual = garmentFieldsSchema.parse({ name: 'Моя рубашка', type: 'shirt', bodyAreas: ['torso'], seasons: ['summer'] });

describe.skipIf(!url)('recognition dispatch boundary with real PostgreSQL transactions', () => {
  const administrator = url ? createDatabase(url) : null;
  const database = url ? createDatabase(url, schema) : null;
  const operations = database ? createOperationsRepository(database) : null;
  const wardrobe = database ? createWardrobeRepository(database) : null;
  const recognition = database ? createRecognitionService({ database, repository: operations!, enabled: true }) : null;
  // Only file I/O is replaced. Admission, draft mutations and dispatch validation use real transactions.
  const context = database ? createRecognitionContext(database, '/unused-private-photo-root', async () => Buffer.from('normalized fixture')) : null;

  beforeAll(async () => {
    await administrator!.schema.createSchema(schema);
    await migrateDatabase(database!, schema);
  });
  afterAll(async () => {
    await database!.destroy();
    await administrator!.schema.dropSchemaIfExists(schema, true);
    await administrator!.destroy();
  });
  async function admitDraft() {
    const id = randomUUID();
    const draft = await wardrobe!.createDraft({
      id, key: `${id}.jpg`, aiKey: `${id}.ai.jpg`, width: 128, height: 128, aiWidth: 128, aiHeight: 128,
      state: 'draft', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const operation = await recognition!.start(draft.id, randomUUID());
    return { draft, operation };
  }
  async function expectNoCharge(operationId: string) {
    expect(await operations!.get(operationId)).toMatchObject({ sendState: 'not_sent', settlementState: 'released' });
    const row = await database!('ai_operations').where({ id: operationId }).first();
    expect(row.dispatch_at).toBeNull();
    expect(await operations!.budget()).toMatchObject({ confirmedCostMicroUsd: 0, activeReservedMicroUsd: 0, unknownReservedMicroUsd: 0 });
  }

  for (const action of ['cancel', 'save'] as const) {
    it(`does not dispatch when ${action} commits after the preliminary context check`, async () => {
      const { draft, operation } = await admitDraft();
      const provider = vi.fn().mockRejectedValue(new Error('Provider must never be invoked'));
      let preliminaryWasCurrent = false;
      await runRecognitionOnce({
        workerId: randomUUID(), repository: operations!, provider,
        context: { ...context!, isCurrent: async active => {
          preliminaryWasCurrent = await context!.isCurrent(active);
          if (action === 'cancel') await wardrobe!.cancelDraft(draft.id);
          else await wardrobe!.saveDraft(draft.id, manual);
          return preliminaryWasCurrent;
        } },
      });
      expect(preliminaryWasCurrent).toBe(true);
      expect(provider).not.toHaveBeenCalled();
      expect(await operations!.get(operation.id)).toMatchObject({ status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE' });
      await expectNoCharge(operation.id);
      const persisted = await database!('garment_drafts').where({ id: draft.id }).first();
      expect(persisted.ai_proposal).toBeNull();
      if (action === 'save') expect((await wardrobe!.list()).garments.find(item => item.id === persisted.garment_id)?.fields).toEqual(manual);
    });
  }

  it('rechecks the deadline after draft validation and releases the unspent reservation during recovery', async () => {
    const { operation } = await admitDraft();
    let clock = new Date(operation.createdAt);
    let validated = false;
    const provider = vi.fn().mockRejectedValue(new Error('Provider must never be invoked'));
    await runRecognitionOnce({
      workerId: randomUUID(), repository: operations!, provider, now: () => clock,
      context: { ...context!, canDispatch: async (transaction, active) => {
        validated = await context!.canDispatch(transaction, active);
        clock = new Date(Date.parse(active.deadlineAt) + 1);
        return validated;
      } },
    });
    expect(validated).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(await operations!.get(operation.id)).toMatchObject({ status: 'running', sendState: 'not_sent', settlementState: 'reserved' });
    await operations!.recover(clock);
    expect(await operations!.get(operation.id)).toMatchObject({ status: 'timed_out', errorCode: 'DEADLINE_EXCEEDED' });
    await expectNoCharge(operation.id);
  });
});
