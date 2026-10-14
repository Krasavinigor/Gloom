import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createWardrobeRepository } from '../../src/server/wardrobe/repository';
import { garmentFieldsSchema, type PhotoAsset } from '../../src/features/wardrobe/schema';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `wardrobe_test_${randomUUID().replaceAll('-', '')}`;
const fields = garmentFieldsSchema.parse({
  name: 'Рубашка',
  type: 'shirt',
  bodyAreas: ['torso'],
  seasons: ['summer'],
});
const asset = (expiresAt = new Date(Date.now() + 86_400_000).toISOString()): PhotoAsset => {
  const id = randomUUID();
  return {
    id,
    key: `${id}.jpg`,
    aiKey: `${id}.ai.jpg`,
    width: 100,
    height: 100,
    aiWidth: 100,
    aiHeight: 100,
    state: 'draft',
    expiresAt,
  };
};

describe.skipIf(!url)('wardrobe PostgreSQL repository', () => {
  const admin = url ? createDatabase(url) : null;
  const db = url ? createDatabase(url, schema) : null;
  const repository = db ? createWardrobeRepository(db) : null;
  beforeAll(async () => {
    await admin!.schema.createSchema(schema);
    await migrateDatabase(db!, schema);
  });
  afterAll(async () => {
    await db!.destroy();
    await admin!.schema.dropSchemaIfExists(schema, true);
    await admin!.destroy();
  });

  it('saves concurrently once, persists corrections, rejects conflicts, and hides deleted photos immediately', async () => {
    const photo = asset();
    const draft = await repository!.createDraft(photo);
    expect(await repository!.getDraft(draft.id)).toEqual(draft);
    expect(await repository!.getAsset(photo.id)).toEqual(photo);
    expect((await repository!.list()).garments).toEqual([]);
    const [first, duplicate] = await Promise.all([
      repository!.saveDraft(draft.id, fields),
      repository!.saveDraft(draft.id, fields),
    ]);
    expect(first).toEqual(duplicate);
    expect((await repository!.list()).wardrobeVersion).toBe(1);
    await expect(
      repository!.saveDraft(draft.id, { ...fields, name: 'Другие поля' }),
    ).rejects.toMatchObject({ status: 409 });
    const edited = await repository!.update(first.id, first.version, {
      ...fields,
      name: 'Исправлено',
    });
    expect(edited.version).toBe(2);
    await expect(repository!.update(first.id, first.version, fields)).rejects.toMatchObject({
      status: 409,
    });
    await expect(repository!.delete(first.id, first.version)).rejects.toMatchObject({
      status: 409,
    });
    expect((await repository!.delete(first.id, edited.version)).alreadyDeleted).toBe(false);
    expect((await repository!.delete(first.id, edited.version)).alreadyDeleted).toBe(true);
    expect(await repository!.getAsset(photo.id)).toBeNull();
    expect((await repository!.list()).pendingDeletions).toContain(first.id);
    expect(await repository!.assetReferencedKey(photo.key)).toBe(true);
    expect((await repository!.getDeletedAsset(first.id))?.id).toBe(photo.id);
    await repository!.completeCleanup(photo.id);
    await repository!.completeCleanup(photo.id);
    expect(await repository!.findAsset(photo.id)).toBeNull();
    expect(await repository!.getDeletedAsset(first.id)).toBeNull();
    expect(await repository!.assetReferencedKey(photo.key)).toBe(false);
    expect((await repository!.list()).wardrobeVersion).toBe(3);
    await expect(repository!.saveDraft(draft.id, fields)).rejects.toMatchObject({ status: 410 });
  });

  it('expires and cancels only unused photos, never an attached photo', async () => {
    const expired = asset(new Date(Date.now() - 1000).toISOString());
    const expiredDraft = await repository!.createDraft(expired);
    expect(await repository!.getAsset(expired.id)).toBeNull();
    await expect(repository!.getDraft(expiredDraft.id)).rejects.toMatchObject({ status: 410 });
    await expect(repository!.saveDraft(expiredDraft.id, fields)).rejects.toMatchObject({
      status: 410,
    });
    await repository!.expireDrafts(new Date());
    expect((await repository!.listDeletePending()).map((entry) => entry.id)).toContain(expired.id);
    const fresh = asset();
    const draft = await repository!.createDraft(fresh);
    await repository!.cancelDraft(draft.id);
    await repository!.cancelDraft(draft.id);
    expect(await repository!.getAsset(fresh.id)).toBeNull();
    await expect(repository!.saveDraft(draft.id, fields)).rejects.toMatchObject({ status: 410 });
    const attached = asset();
    const attachedDraft = await repository!.createDraft(attached);
    await repository!.saveDraft(attachedDraft.id, fields);
    await expect(
      repository!.getDeletedAsset((await repository!.saveDraft(attachedDraft.id, fields)).id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(repository!.cancelDraft(attachedDraft.id)).rejects.toMatchObject({ status: 409 });
    await repository!.expireDrafts(new Date(Date.now() + 172_800_000));
    expect((await repository!.getAsset(attached.id))?.state).toBe('attached');
    await repository!.completeCleanup(attached.id);
    expect((await repository!.findAsset(attached.id))?.state).toBe('attached');
  });

  it('rejects missing resources and malformed fields without writes', async () => {
    const id = randomUUID();
    await expect(repository!.getDraft(id)).rejects.toMatchObject({ status: 404 });
    await expect(repository!.saveDraft(id, fields)).rejects.toMatchObject({ status: 404 });
    await expect(repository!.update(id, 1, fields)).rejects.toMatchObject({ status: 404 });
    await expect(repository!.delete(id, 1)).rejects.toMatchObject({ status: 404 });
    await expect(repository!.cancelDraft(id)).rejects.toMatchObject({ status: 404 });
    expect(await repository!.getAsset(id)).toBeNull();
    await expect(repository!.getDeletedAsset(id)).rejects.toMatchObject({ status: 404 });
    await expect(repository!.update(id, 1, { ...fields, name: '' })).rejects.toThrow();
    await expect(
      db!('photo_assets').insert({ id: randomUUID(), key: 'invalid' }),
    ).rejects.toThrow();
  });
});
