import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  garmentFieldsSchema,
  type Draft,
  type Garment,
  type WardrobeSnapshot,
} from '../../src/features/wardrobe/schema';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createWardrobeHandlers } from '../../src/server/http/wardrobe-handlers';
import { createWardrobeRepository } from '../../src/server/wardrobe/repository';
import { createWardrobeService } from '../../src/server/wardrobe/service';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `wardrobe_api_${randomUUID().replaceAll('-', '')}`;
const origin = 'http://127.0.0.1:3100';
const fields = garmentFieldsSchema.parse({
  name: 'Рубашка',
  type: 'shirt',
  bodyAreas: ['torso'],
  seasons: ['summer'],
});

function request(
  path: string,
  method = 'GET',
  body?: BodyInit,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(`${origin}${path}`, {
    method,
    body,
    headers: { host: '127.0.0.1:3100', ...(method === 'GET' ? {} : { origin }), ...extraHeaders },
  });
}
function jsonRequest(path: string, method: string, body: unknown): Request {
  return request(path, method, JSON.stringify(body), { 'content-type': 'application/json' });
}
async function data<T>(response: Response, expectedStatus = 200): Promise<T> {
  const payload = await response.json();
  expect(response.status, JSON.stringify(payload)).toBe(expectedStatus);
  expect(payload.success).toBe(true);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return payload.data as T;
}
async function error(response: Response, status: number, code?: string): Promise<void> {
  expect(response.status).toBe(status);
  const payload = await response.json();
  expect(payload.success).toBe(false);
  if (code) expect(payload.error.code).toBe(code);
  expect(JSON.stringify(payload)).not.toContain('postgresql://');
}

// Native Request/FormData + real PostgreSQL and private files; no external AI calls.
describe.skipIf(!url)('wardrobe API and service integration', () => {
  const admin = url ? createDatabase(url) : null;
  const database = url ? createDatabase(url, schema) : null;
  const repository = database ? createWardrobeRepository(database) : null;
  let root: string;
  let service: ReturnType<typeof createWardrobeService>;
  let handlers: ReturnType<typeof createWardrobeHandlers>;
  let photo: Buffer;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wardrobe-api-'));
    await admin!.schema.createSchema(schema);
    await migrateDatabase(database!, schema);
    service = createWardrobeService(repository!, root);
    handlers = createWardrobeHandlers(async () => service);
    photo = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#477a59' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await database!.destroy();
    await admin!.schema.dropSchemaIfExists(schema, true);
    await admin!.destroy();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function upload(
    filename = '../../public/stolen.html',
    bytes: Buffer = photo,
  ): Promise<Draft> {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array(bytes)], filename, { type: 'image/jpeg' }));
    const response = await handlers.upload(request('/api/garment-drafts', 'POST', form));
    const draft = await data<Draft>(response, 201);
    expect(response.headers.get('location')).toBe(`/api/garment-drafts/${draft.id}`);
    return draft;
  }
  async function save(draft: Draft): Promise<Garment> {
    return data<Garment>(
      await handlers.save(jsonRequest('/api/garments', 'POST', { draftId: draft.id, fields })),
      201,
    );
  }

  it('normalizes an upload, saves once, reloads, edits with version checks, and deletes idempotently', async () => {
    const before = await data<WardrobeSnapshot>(await handlers.list(request('/api/garments')));
    const draft = await upload();
    expect(
      await data<Draft>(
        await handlers.draftGet(request(`/api/garment-drafts/${draft.id}`), draft.id),
      ),
    ).toEqual(draft);
    expect(
      (await data<WardrobeSnapshot>(await handlers.list(request('/api/garments')))).garments,
    ).toEqual(before.garments);
    const assetResponse = await handlers.asset(
      request(`/api/assets/${draft.photoId}`),
      draft.photoId,
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const metadata = await sharp(Buffer.from(await assetResponse.arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ width: 80, height: 120, format: 'jpeg' });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect((await readdir(root)).filter((key) => key.includes(draft.photoId))).toEqual(
      expect.arrayContaining([`${draft.photoId}.jpg`, `${draft.photoId}.ai.jpg`]),
    );
    expect((await readdir(root)).some((key) => key.includes('stolen'))).toBe(false);
    const garment = await save(draft);
    expect(await save(draft)).toEqual(garment);
    const snapshot = await data<WardrobeSnapshot>(await handlers.list(request('/api/garments')));
    expect(snapshot.wardrobeVersion).toBe(before.wardrobeVersion + 1);
    expect(snapshot.garments).toContainEqual(garment);
    const corrected = {
      ...fields,
      name: 'Моя зелёная рубашка',
      windProtection: 'confirmed' as const,
    };
    const edited = await data<Garment>(
      await handlers.update(
        jsonRequest(`/api/garments/${garment.id}`, 'PATCH', { version: 1, fields: corrected }),
        garment.id,
      ),
    );
    expect(edited).toMatchObject({ version: 2, fields: corrected });
    await error(
      await handlers.update(
        jsonRequest(`/api/garments/${garment.id}`, 'PATCH', { version: 1, fields }),
        garment.id,
      ),
      409,
    );
    await error(
      await handlers.delete(
        jsonRequest(`/api/garments/${garment.id}`, 'DELETE', { version: 1 }),
        garment.id,
      ),
      409,
    );
    expect(
      await data(
        await handlers.delete(
          jsonRequest(`/api/garments/${garment.id}`, 'DELETE', { version: 2 }),
          garment.id,
        ),
      ),
    ).toEqual({ cleanupPending: false });
    expect(
      await data(
        await handlers.delete(
          jsonRequest(`/api/garments/${garment.id}`, 'DELETE', { version: 2 }),
          garment.id,
        ),
      ),
    ).toEqual({ cleanupPending: false });
    await error(
      await handlers.asset(request(`/api/assets/${draft.photoId}`), draft.photoId),
      404,
      'photo_unavailable',
    );
    await expect(stat(join(root, `${draft.photoId}.jpg`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(root, `${draft.photoId}.ai.jpg`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const deleted = await data<WardrobeSnapshot>(await handlers.list(request('/api/garments')));
    expect(deleted.wardrobeVersion).toBe(before.wardrobeVersion + 3);
    expect(deleted.garments.some((item) => item.id === garment.id)).toBe(false);
  });

  it('cancels a draft and forbids later photo access or saving', async () => {
    const draft = await upload('fixture.jpg');
    expect(
      await data(
        await handlers.draftCancel(request(`/api/garment-drafts/${draft.id}`, 'DELETE'), draft.id),
      ),
    ).toEqual({ cleanupPending: false });
    await data(
      await handlers.draftCancel(request(`/api/garment-drafts/${draft.id}`, 'DELETE'), draft.id),
    );
    await error(
      await handlers.asset(request(`/api/assets/${draft.photoId}`), draft.photoId),
      404,
      'photo_unavailable',
    );
    await error(
      await handlers.save(jsonRequest('/api/garments', 'POST', { draftId: draft.id, fields })),
      410,
    );
  });

  it('keeps the card when its physical image is missing and allows deletion to complete', async () => {
    const draft = await upload();
    const garment = await save(draft);
    await unlink(join(root, `${draft.photoId}.jpg`));
    await error(
      await handlers.asset(request(`/api/assets/${draft.photoId}`), draft.photoId),
      404,
      'photo_missing',
    );
    expect(
      (await data<WardrobeSnapshot>(await handlers.list(request('/api/garments')))).garments,
    ).toContainEqual(garment);
    expect(
      await data(
        await handlers.delete(
          jsonRequest(`/api/garments/${garment.id}`, 'DELETE', { version: 1 }),
          garment.id,
        ),
      ),
    ).toEqual({ cleanupPending: false });
  });

  it('retains a pending deletion after a real filesystem failure and retries safely', async () => {
    const draft = await upload();
    const garment = await save(draft);
    const path = join(root, `${draft.photoId}.jpg`);
    await unlink(path);
    await mkdir(path, { mode: 0o700 });
    expect(
      await data(
        await handlers.delete(
          jsonRequest(`/api/garments/${garment.id}`, 'DELETE', { version: 1 }),
          garment.id,
        ),
      ),
    ).toEqual({ cleanupPending: true });
    await error(
      await handlers.asset(request(`/api/assets/${draft.photoId}`), draft.photoId),
      404,
      'photo_unavailable',
    );
    expect(
      (await data<WardrobeSnapshot>(await handlers.list(request('/api/garments'))))
        .pendingDeletions,
    ).toContain(garment.id);
    await rm(path, { recursive: true });
    expect(
      await data(
        await handlers.retryCleanup(
          request(`/api/garments/${garment.id}/cleanup`, 'POST'),
          garment.id,
        ),
      ),
    ).toEqual({ cleanupPending: false });
    expect(
      (await data<WardrobeSnapshot>(await handlers.list(request('/api/garments'))))
        .pendingDeletions,
    ).not.toContain(garment.id);
  });

  it('denies expired draft assets before cleanup and removes only aged unreferenced managed files', async () => {
    const activeDraft = await upload();
    const garment = await save(activeDraft);
    const expired = await upload();
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await database!('garment_drafts').where({ id: expired.id }).update({ expires_at: past });
    await database!('photo_assets').where({ id: expired.photoId }).update({ expires_at: past });
    expect(await readFile(join(root, `${expired.photoId}.jpg`))).not.toHaveLength(0);
    await error(
      await handlers.asset(request(`/api/assets/${expired.photoId}`), expired.photoId),
      404,
      'photo_unavailable',
    );
    await error(
      await handlers.draftGet(request(`/api/garment-drafts/${expired.id}`), expired.id),
      410,
    );
    await error(
      await handlers.save(jsonRequest('/api/garments', 'POST', { draftId: expired.id, fields })),
      410,
    );
    const orphan = `${randomUUID()}.jpg`;
    const unfinished = `${randomUUID()}.display.tmp`;
    const fresh = `${randomUUID()}.jpg`;
    const unrelated = 'user-notes.txt';
    for (const key of [orphan, unfinished, fresh, unrelated])
      await writeFile(join(root, key), photo);
    for (const key of [
      orphan,
      unfinished,
      unrelated,
      `${activeDraft.photoId}.jpg`,
      `${activeDraft.photoId}.ai.jpg`,
    ])
      await utimes(join(root, key), past, past);
    expect(await service.cleanup()).toMatchObject({ completed: 1, pending: 0, orphanedRemoved: 2 });
    await expect(stat(join(root, orphan))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, unfinished))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, fresh))).toEqual(photo);
    expect(await readFile(join(root, unrelated))).toEqual(photo);
    expect(
      (await handlers.asset(request(`/api/assets/${activeDraft.photoId}`), activeDraft.photoId))
        .status,
    ).toBe(200);
    expect(
      (await data<WardrobeSnapshot>(await handlers.list(request('/api/garments')))).garments,
    ).toContainEqual(garment);
  });

  it('rejects hostile origins, paths, malformed input, and oversized streams before writes', async () => {
    const before = await repository!.list();
    const beforeFiles = await readdir(root);
    await error(
      await handlers.save(
        request('/api/garments', 'POST', '{}', {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        }),
      ),
      403,
      'forbidden_origin',
    );
    await error(
      await handlers.list(request('/api/garments', 'GET', undefined, { host: 'evil.example' })),
      403,
      'forbidden_host',
    );
    await error(
      await handlers.save(
        request('/api/garments', 'POST', '{broken', { 'content-type': 'application/json' }),
      ),
      400,
      'invalid_json',
    );
    await error(
      await handlers.save(
        jsonRequest('/api/garments', 'POST', {
          draftId: randomUUID(),
          fields: { ...fields, name: '' },
        }),
      ),
      400,
      'invalid_fields',
    );
    await error(
      await handlers.asset(request('/api/assets/invalid'), '../../etc/passwd'),
      400,
      'invalid_fields',
    );
    const invalidPhoto = new FormData();
    invalidPhoto.set('photo', new File(['not a photo'], 'evil.jpg', { type: 'image/jpeg' }));
    await error(
      await handlers.upload(request('/api/garment-drafts', 'POST', invalidPhoto)),
      422,
      'INVALID_PHOTO',
    );
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = new Request(`${origin}/api/garment-drafts`, {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3100',
        origin,
        'content-type': 'multipart/form-data; boundary=oversized',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await error(await handlers.upload(streamed), 413, 'too_large');
    expect(cancelled).toBe(true);
    expect(await repository!.list()).toEqual(before);
    expect(await readdir(root)).toEqual(beforeFiles);
  });
});
