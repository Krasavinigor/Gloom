import { randomUUID } from 'node:crypto';
import type { GarmentFields, PhotoAsset } from '../../features/wardrobe/schema';
import { ApiError } from '../http/errors';
import { normalizePhoto } from '../storage/normalize-photo';
import { deletePhotoFiles, listOrphanCandidates, readPhotoFile, removeManagedFile, writePhotoFiles } from '../storage/photo-files';
import type { WardrobeRepository } from './repository';

const photoIO = { normalizePhoto, deletePhotoFiles, listOrphanCandidates, readPhotoFile, removeManagedFile, writePhotoFiles };
const DRAFT_LIFETIME = 24 * 60 * 60 * 1000;
const ORPHAN_GRACE = 60 * 60 * 1000;

export function createWardrobeService(repository: WardrobeRepository, root: string, files = photoIO) {
  let lastMaintenance = 0;
  async function cleanupAsset(asset: PhotoAsset): Promise<boolean> {
    if (asset.state !== 'delete_pending') throw new ApiError('cleanup_conflict', 409, 'Фотография ещё используется и не может быть удалена.');
    try {
      await files.deletePhotoFiles(root, asset.key, asset.aiKey);
      await repository.completeCleanup(asset.id);
      return true;
    } catch {
      console.error('Photo cleanup deferred; pending record retained.', { photoId: asset.id });
      return false;
    }
  }

  async function cleanup(now = new Date()) {
    await repository.expireDrafts(now);
    const pendingAssets = await repository.listDeletePending();
    const outcomes = await Promise.all(pendingAssets.map(cleanupAsset));
    let orphanedRemoved = 0;
    let orphanedPending = 0;
    for (const key of await files.listOrphanCandidates(root, new Date(now.getTime() - ORPHAN_GRACE))) {
      const id = key.match(/^([a-f\d-]{36})\./)?.[1];
      const referenced = await repository.assetReferencedKey(key)
        || (id && (await repository.assetReferencedKey(`${id}.jpg`) || await repository.assetReferencedKey(`${id}.ai.jpg`)));
      if (!referenced) {
        try { await files.removeManagedFile(root, key); orphanedRemoved += 1; }
        catch { orphanedPending += 1; console.error('Orphan cleanup deferred.'); }
      }
    }
    return { completed: outcomes.filter(Boolean).length, pending: outcomes.filter(outcome => !outcome).length + orphanedPending, orphanedRemoved };
  }

  async function upload(input: Buffer) {
    if (Date.now() - lastMaintenance >= 60_000) {
      lastMaintenance = Date.now();
      try { await cleanup(); }
      catch { console.error('Photo maintenance deferred; upload can continue.'); }
    }
    const normalized = await files.normalizePhoto(input);
    const id = randomUUID();
    const keys = await files.writePhotoFiles(root, id, normalized);
    try {
      return await repository.createDraft({ id, ...keys, width: normalized.width, height: normalized.height,
        aiWidth: normalized.aiWidth, aiHeight: normalized.aiHeight, state: 'draft',
        expiresAt: new Date(Date.now() + DRAFT_LIFETIME).toISOString() });
    } catch (error) {
      // A dropped connection can hide a committed transaction. Keep referenced/uncertain files.
      try {
        if (!await repository.assetReferencedKey(keys.key) && !await repository.assetReferencedKey(keys.aiKey)) {
          await files.deletePhotoFiles(root, keys.key, keys.aiKey);
        }
      }
      catch { console.error('Upload compensation deferred to orphan cleanup.', { photoId: id }); }
      throw error;
    }
  }

  async function readAsset(id: string): Promise<Buffer> {
    const asset = await repository.getAsset(id);
    if (!asset) throw new ApiError('photo_unavailable', 404, 'Фотография больше недоступна.');
    try { return await files.readPhotoFile(root, asset.key); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ApiError('photo_missing', 404, 'Файл фотографии не найден. Описание вещи сохранено.');
      }
      throw error;
    }
  }

  async function deleteGarment(id: string, version: number) {
    const result = await repository.delete(id, version);
    return { cleanupPending: result.photo ? !await cleanupAsset(result.photo) : false };
  }

  async function retryCleanup(id: string) {
    const asset = await repository.getDeletedAsset(id);
    return { cleanupPending: asset ? !await cleanupAsset(asset) : false };
  }

  async function cancelDraft(id: string) {
    await repository.cancelDraft(id);
    try {
      const result = await cleanup();
      return { cleanupPending: result.pending > 0 };
    } catch {
      console.error('Draft closed; photo maintenance deferred.');
      return { cleanupPending: true };
    }
  }

  return { list: () => repository.list(), getDraft: (id: string) => repository.getDraft(id),
    saveDraft: (id: string, fields: GarmentFields) => repository.saveDraft(id, fields),
    update: (id: string, version: number, fields: GarmentFields) => repository.update(id, version, fields),
    upload, readAsset, deleteGarment, retryCleanup, cancelDraft, cleanup };
}

export type WardrobeService = ReturnType<typeof createWardrobeService>;
