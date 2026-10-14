import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { WardrobeRepository } from '../../src/server/wardrobe/repository';
import { createWardrobeService } from '../../src/server/wardrobe/service';

function setup() {
  const asset = { id: randomUUID(), key: 'one.jpg', aiKey: 'one.ai.jpg', state: 'delete_pending' as const,
    width: 1, height: 1, aiWidth: 1, aiHeight: 1, expiresAt: null };
  const repository = {
    createDraft: vi.fn().mockRejectedValue(new Error('DB failed')),
    completeCleanup: vi.fn(), expireDrafts: vi.fn(),
    listDeletePending: vi.fn().mockResolvedValue([]), assetReferencedKey: vi.fn().mockResolvedValue(false),
    getAsset: vi.fn().mockResolvedValue(null), getDeletedAsset: vi.fn().mockResolvedValue(asset),
    delete: vi.fn().mockResolvedValue({ photo: asset, alreadyDeleted: false }),
    list: vi.fn().mockResolvedValue({ garments: [], wardrobeVersion: 1, pendingDeletions: [] }),
  };
  const files = {
    normalizePhoto: vi.fn().mockResolvedValue({ display: Buffer.from('d'), ai: Buffer.from('a'), width: 1, height: 1, aiWidth: 1, aiHeight: 1 }),
    writePhotoFiles: vi.fn().mockResolvedValue({ key: 'new.jpg', aiKey: 'new.ai.jpg' }),
    deletePhotoFiles: vi.fn(), readPhotoFile: vi.fn().mockResolvedValue(Buffer.from('image')),
    listOrphanCandidates: vi.fn().mockResolvedValue([]), removeManagedFile: vi.fn(),
  };
  const service = createWardrobeService(repository as unknown as WardrobeRepository, '/private/test', files);
  return { repository, files, asset, service };
}

describe('wardrobe service compensation and cleanup', () => {
  it('compensates files when database creation fails and does not hide the error', async () => {
    const { files, service } = setup();
    await expect(service.upload(Buffer.from('upload'))).rejects.toThrow('DB failed');
    expect(files.deletePhotoFiles).toHaveBeenCalledWith('/private/test', 'new.jpg', 'new.ai.jpg');
  });
  it('keeps a durable pending record if unlink fails, then clears it on retry', async () => {
    const { files, repository, service } = setup();
    files.deletePhotoFiles.mockRejectedValueOnce(new Error('permission'));
    expect(await service.deleteGarment(randomUUID(), 1)).toEqual({ cleanupPending: true });
    expect(repository.completeCleanup).not.toHaveBeenCalled();
    expect(await service.retryCleanup(randomUUID())).toEqual({ cleanupPending: false });
    expect(repository.completeCleanup).toHaveBeenCalledOnce();
  });
  it('preserves files if a failed database response has an uncertain commit outcome', async () => {
    const { repository, files, service } = setup();
    repository.assetReferencedKey.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.upload(Buffer.from('upload'))).rejects.toThrow('DB failed');
    expect(files.writePhotoFiles).toHaveBeenCalledOnce();
    expect(files.deletePhotoFiles).not.toHaveBeenCalled();
  });
  it('preserves files when a fresh lookup finds the committed asset after a failed response', async () => {
    const { repository, files, service } = setup();
    repository.assetReferencedKey.mockResolvedValue(true);
    await expect(service.upload(Buffer.from('upload'))).rejects.toThrow('DB failed');
    expect(files.deletePhotoFiles).not.toHaveBeenCalled();
  });
  it('refuses unknown assets and reports a missing managed file distinctly', async () => {
    const { repository, files, asset, service } = setup();
    await expect(service.readAsset(randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(files.readPhotoFile).not.toHaveBeenCalled();
    repository.getAsset.mockResolvedValue(asset);
    files.readPhotoFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(service.readAsset(asset.id)).rejects.toMatchObject({ code: 'photo_missing', status: 404 });
  });
  it('rechecks orphan references after the grace period and preserves live assets', async () => {
    const { repository, files, service } = setup();
    files.listOrphanCandidates.mockResolvedValue(['unused.jpg', 'attached.jpg']);
    repository.assetReferencedKey.mockImplementation(async key => key === 'attached.jpg');
    const now = new Date('2026-10-14T10:00:00Z');
    const result = await service.cleanup(now);
    expect(files.listOrphanCandidates).toHaveBeenCalledWith('/private/test', new Date('2026-10-14T09:00:00Z'));
    expect(files.removeManagedFile).toHaveBeenCalledExactlyOnceWith('/private/test', 'unused.jpg');
    expect(result).toEqual({ completed: 0, pending: 0, orphanedRemoved: 1 });
  });
  it('read-only listing never performs expiry or file mutations', async () => {
    const { repository, files, service } = setup();
    await service.list();
    expect(repository.expireDrafts).not.toHaveBeenCalled();
    expect(files.deletePhotoFiles).not.toHaveBeenCalled();
  });
});
