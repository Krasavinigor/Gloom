import { mkdtemp, readFile, rm, symlink, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePrivateStorage } from '../../src/server/storage/private-storage';

describe('private local storage', () => {
  it('creates a private directory and preserves files on another initialization', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'wardrobe-storage-'));
    try {
      const root = join(projectRoot, '.data/photos');
      await preparePrivateStorage(root, projectRoot);
      await writeFile(join(root, 'fixture.txt'), 'test-only fixture');
      await preparePrivateStorage(root, projectRoot);
      expect(await readFile(join(root, 'fixture.txt'), 'utf8')).toBe('test-only fixture');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects an apparently private directory that resolves through a public symlink', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'wardrobe-storage-'));
    try {
      await mkdir(join(projectRoot, 'public'));
      await symlink(join(projectRoot, 'public'), join(projectRoot, 'private-link'));
      await expect(preparePrivateStorage(join(projectRoot, 'private-link/photos'), projectRoot))
        .rejects.toThrow('FILE_STORAGE_ROOT');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects an existing readable photo directory without changing its permissions', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'wardrobe-storage-'));
    const root = join(projectRoot, 'photos');
    try {
      await mkdir(root, { mode: 0o755 });
      await expect(preparePrivateStorage(root, projectRoot)).rejects.toThrow('0700');
      expect((await stat(root)).mode & 0o777).toBe(0o755);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each(['project', 'ancestor'])('rejects a photo symlink to the %s directory', async (target) => {
    const fixture = await mkdtemp(join(tmpdir(), 'wardrobe-storage-'));
    const projectRoot = join(fixture, 'project');
    try {
      await mkdir(projectRoot, { mode: 0o700 });
      const link = join(projectRoot, 'photo-link');
      await symlink(target === 'project' ? projectRoot : fixture, link);
      await expect(preparePrivateStorage(link, projectRoot)).rejects.toThrow('FILE_STORAGE_ROOT');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
