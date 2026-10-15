import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { garmentFieldsSchema } from '../../src/features/wardrobe/schema';
import { recognitionProposalSchema } from '../../src/features/recognition/schema';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { createOperationsRepository } from '../../src/server/operations/repository';
import { createRecognitionContext } from '../../src/server/recognition/context';
import { createRecognitionService } from '../../src/server/recognition/service';
import { createWardrobeRepository } from '../../src/server/wardrobe/repository';
import { createWardrobeService } from '../../src/server/wardrobe/service';
import { runRecognitionOnce, type RecognitionWorkerDependencies } from '../../src/worker/recognition-worker';
import { createRecognitionHandlers } from '../../src/server/http/recognition-handlers';
import { createPgOperationEventHub } from '../../src/server/operations/events';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `recognition_test_${randomUUID().replaceAll('-', '')}`;
const fields = garmentFieldsSchema.parse({ name: 'Моя рубашка', type: 'shirt', bodyAreas: ['torso'], seasons: ['summer'] });
const proposal = recognitionProposalSchema.parse({ kind: 'item', fields: { ...fields, name: 'AI-предложение', rainProtection: 'confirmed' }, warnings: ['Оценка по фотографии.'] });
const providerResult = { proposal, usage: { inputTokens: 100, outputTokens: 80, cachedInputTokens: 0, cacheWriteTokens: 0, serviceTier: 'default' },
  requestId: 'req_integration_fixture', responseId: 'resp_integration_fixture' };

// Real transactions, private normalized photographs and worker publication; no network AI calls.
describe.skipIf(!url)('recognition service and durable draft publication', () => {
  const administrator = url ? createDatabase(url) : null;
  const database = url ? createDatabase(url, schema) : null;
  const operations = database ? createOperationsRepository(database) : null;
  const recognition = database ? createRecognitionService({ database, repository: operations!, enabled: true }) : null;
  const wardrobeRepository = database ? createWardrobeRepository(database) : null;
  let root: string;
  let wardrobe: ReturnType<typeof createWardrobeService>;
  let context: ReturnType<typeof createRecognitionContext>;
  let photo: Buffer;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'recognition-integration-'));
    await administrator!.schema.createSchema(schema);
    await migrateDatabase(database!, schema);
    wardrobe = createWardrobeService(wardrobeRepository!, root);
    context = createRecognitionContext(database!, root);
    photo = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#527861' } }).jpeg().toBuffer();
  });
  afterAll(async () => {
    await database!.destroy();
    await administrator!.schema.dropSchemaIfExists(schema, true);
    await administrator!.destroy();
    if (root) await rm(root, { recursive: true, force: true });
  });
  function dependencies(provider: RecognitionWorkerDependencies['provider'] = async () => providerResult) {
    return { workerId: randomUUID(), repository: operations!, context, provider };
  }
  async function countOperations() {
    return Number((await database!('ai_operations').count('* as count').first())!.count);
  }

  it('admits exactly once and publishes a separate proposal, leaving manual fields and the wardrobe unchanged', async () => {
    const draft = await wardrobe.upload(photo);
    const key = randomUUID();
    const before = await wardrobe.list();
    const operation = await recognition!.start(draft.id, key);
    expect(await recognition!.start(draft.id, key)).toEqual(operation);
    expect((await recognition!.start(draft.id, randomUUID())).id).toBe(operation.id);
    expect(await database!('ai_operations').where({ target_id: draft.id })).toHaveLength(1);
    let calls = 0;
    const deps = dependencies(async ({ photo: normalized }) => {
      calls += 1;
      expect((await sharp(normalized).metadata()).format).toBe('jpeg');
      return providerResult;
    });
    expect(await runRecognitionOnce(deps)).toBe(true);
    expect(await runRecognitionOnce(deps)).toBe(false);
    expect(calls).toBe(1);
    expect(await operations!.get(operation.id)).toMatchObject({ status: 'succeeded', settlementState: 'confirmed' });
    expect(await wardrobe.getDraft(draft.id)).toMatchObject({ fields: null, garmentId: null, recognitionOperationId: operation.id,
      aiProposal: { kind: 'item', fields: { name: 'AI-предложение', rainProtection: 'unknown', windProtection: 'unknown' } } });
    expect(await wardrobe.list()).toEqual(before);
    const saved = await wardrobe.saveDraft(draft.id, fields);
    expect(saved.fields).toEqual(fields);
    expect((await database!('ai_cost_ledger').where({ operation_id: operation.id }).first()).usage).toMatchObject({ inputTokens: 100, outputTokens: 80 });
  });

  it('rejects disabled, absent, expired and already saved drafts without leaving a charge', async () => {
    const before = await countOperations();
    const disabled = createRecognitionService({ database: database!, repository: operations!, enabled: false });
    await expect(disabled.start(randomUUID(), randomUUID())).rejects.toMatchObject({ status: 503 });
    await expect(recognition!.start(randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    const expired = await wardrobe.upload(photo);
    await database!('garment_drafts').where({ id: expired.id }).update({ expires_at: new Date(Date.now() - 1_000) });
    await expect(recognition!.start(expired.id, randomUUID())).rejects.toMatchObject({ status: 409 });
    const saved = await wardrobe.upload(photo);
    await wardrobe.saveDraft(saved.id, fields);
    await expect(recognition!.start(saved.id, randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await countOperations()).toBe(before);
  });

  for (const action of ['save', 'cancel'] as const) {
    it(`charges a dispatched response but does not publish after ${action}`, async () => {
      const draft = await wardrobe.upload(photo);
      const operation = await recognition!.start(draft.id, randomUUID());
      let dispatched!: () => void;
      let release!: () => void;
      const entered = new Promise<void>(resolve => { dispatched = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const running = runRecognitionOnce(dependencies(async () => { dispatched(); await gate; return providerResult; }));
      await entered;
      const saved = action === 'save' ? await wardrobe.saveDraft(draft.id, fields) : null;
      if (action === 'cancel') await wardrobe.cancelDraft(draft.id);
      release();
      expect(await running).toBe(true);
      expect(await operations!.get(operation.id)).toMatchObject({ status: 'failed', errorCode: 'TARGET_UNAVAILABLE', settlementState: 'confirmed' });
      expect((await database!('garment_drafts').where({ id: draft.id }).first()).ai_proposal).toBeNull();
      if (saved) expect((await wardrobe.list()).garments.find(item => item.id === saved.id)?.fields).toEqual(fields);
      expect(await context.isCurrent({ ...await operations!.getInternal(operation.id), payload: { draftId: draft.id, photoId: draft.photoId } })).toBe(false);
    });
  }

  it('rechecks cancellation before dispatch and releases the reservation without invoking the provider', async () => {
    const draft = await wardrobe.upload(photo);
    const operation = await recognition!.start(draft.id, randomUUID());
    await wardrobe.cancelDraft(draft.id);
    let called = false;
    expect(await runRecognitionOnce(dependencies(async () => { called = true; return providerResult; }))).toBe(true);
    expect(called).toBe(false);
    expect(await operations!.get(operation.id)).toMatchObject({ status: 'interrupted', settlementState: 'released' });
  });

  it('serves committed SSE snapshots, receives real PostgreSQL notifications and reconnects to a terminal result', async () => {
    const hub = createPgOperationEventHub({ connectionString: url! });
    const handlers = createRecognitionHandlers(async () => ({ repository: operations!, recognition: recognition!, eventHub: hub }));
    const draft = await wardrobe.upload(photo);
    const origin = 'http://127.0.0.1:3100';
    const key = randomUUID();
    const admitted = await handlers.start(new Request(`${origin}/api/garment-drafts/${draft.id}/recognition`, {
      method: 'POST', headers: { host: '127.0.0.1:3100', origin, 'Idempotency-Key': key },
    }), draft.id);
    expect(admitted.status).toBe(202);
    const operation = (await admitted.json()).data;
    const controller = new AbortController();
    const streamRequest = () => new Request(`${origin}/api/operation-events?ids=${operation.id}`, {
      headers: { host: '127.0.0.1:3100' }, signal: controller.signal,
    });
    try {
      const response = await handlers.events(streamRequest());
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const initial = new TextDecoder().decode((await reader.read()).value);
      expect(initial).toContain('"status":"queued"');
      await runRecognitionOnce(dependencies());
      let received = '';
      while (!received.includes('"status":"succeeded"')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += new TextDecoder().decode(chunk.value);
      }
      expect(received).toContain('"status":"succeeded"');
      expect(await reader.read()).toMatchObject({ done: true });
      const reconnected = await handlers.events(streamRequest());
      expect(await reconnected.text()).toContain('"status":"succeeded"');
      const retrieved = await handlers.get(new Request(`${origin}/api/operations/${operation.id}`, { headers: { host: '127.0.0.1:3100' } }), operation.id);
      expect((await retrieved.json()).data).toMatchObject({ id: operation.id, status: 'succeeded' });
    } finally { controller.abort(); await hub.dispose(); }
  });
});
