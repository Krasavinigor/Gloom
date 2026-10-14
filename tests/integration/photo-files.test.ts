import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deletePhotoFiles, listOrphanCandidates, readPhotoFile, removeManagedFile, writePhotoFiles } from '../../src/server/storage/photo-files';

let directory: string;
let root: string;
const normalized = { display: Buffer.from('display bytes'), ai: Buffer.from('AI bytes'), width: 4, height: 3, aiWidth: 4, aiHeight: 3 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wardrobe-files-'));
  root = join(directory, 'photos');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('private photo files', () => {
  it('writes private files atomically and reads both copies through validated keys', async () => {
    const id = randomUUID();
    const files = await writePhotoFiles(root, id, normalized);
    expect(files).toEqual({ key: `${id}.jpg`, aiKey: `${id}.ai.jpg` });
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    for (const key of [files.key, files.aiKey]) {
      expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
    }
    expect(await readPhotoFile(root, files.key)).toEqual(normalized.display);
    expect(await readPhotoFile(root, files.aiKey)).toEqual(normalized.ai);
    expect(await readdir(root)).toHaveLength(2);
    await deletePhotoFiles(root, files.key, files.aiKey);
    await deletePhotoFiles(root, files.key, files.aiKey);
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects hostile keys and invalid identifiers without accessing outside files', async () => {
    const outside = join(directory, 'secret.jpg');
    await writeFile(outside, 'secret');
    for (const key of ['../secret.jpg', outside, 'item.jpg', `${randomUUID()}.jpg/extra`, `${randomUUID()}.jpg\\extra`]) {
      await expect(readPhotoFile(root, key)).rejects.toThrow();
      await expect(removeManagedFile(root, key)).rejects.toThrow();
    }
    await expect(writePhotoFiles(root, '../secret', normalized)).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('secret');
  });

  it('refuses symbolic links and directories masquerading as photo files', async () => {
    await mkdir(root, { mode: 0o700 });
    const outside = join(directory, 'secret');
    await writeFile(outside, 'secret');
    const linkKey = `${randomUUID()}.jpg`;
    await symlink(outside, join(root, linkKey));
    await expect(readPhotoFile(root, linkKey)).rejects.toThrow();
    await expect(removeManagedFile(root, linkKey)).rejects.toThrow();
    await expect(deletePhotoFiles(root, linkKey, `${randomUUID()}.ai.jpg`)).rejects.toThrow(/deletion failed/);
    const directoryKey = `${randomUUID()}.jpg`;
    await mkdir(join(root, directoryKey));
    await expect(readPhotoFile(root, directoryKey)).rejects.toThrow();
    await expect(removeManagedFile(root, directoryKey)).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('secret');
  });

  it('preserves existing copies when a duplicate write is attempted', async () => {
    const id = randomUUID();
    const files = await writePhotoFiles(root, id, normalized);
    await expect(writePhotoFiles(root, id, { ...normalized, display: Buffer.from('replacement') })).rejects.toThrow();
    expect(await readPhotoFile(root, files.key)).toEqual(normalized.display);
    expect(await readdir(root)).toHaveLength(2);
  });

  it('does not interfere with another writer holding the same identifier', async () => {
    await mkdir(root, { mode: 0o700 });
    const id = randomUUID();
    const claim = `${id}.write.tmp`;
    await writeFile(join(root, claim), 'another writer');
    await expect(writePhotoFiles(root, id, normalized)).rejects.toThrow();
    expect(await readdir(root)).toEqual([claim]);
    expect(await readFile(join(root, claim), 'utf8')).toBe('another writer');
  });

  it('removes its first temporary file when the second exclusive creation fails', async () => {
    await mkdir(root, { mode: 0o700 });
    const id = randomUUID();
    await writeFile(join(root, `${id}.ai.tmp`), 'previous temporary copy');
    await expect(writePhotoFiles(root, id, normalized)).rejects.toThrow();
    expect(await readdir(root)).toEqual([`${id}.ai.tmp`]);
    expect(await readFile(join(root, `${id}.ai.tmp`), 'utf8')).toBe('previous temporary copy');
  });

  it('compensates its temporary files if a final destination is unusable', async () => {
    await mkdir(root, { mode: 0o700 });
    const id = randomUUID();
    await mkdir(join(root, `${id}.ai.jpg`));
    await expect(writePhotoFiles(root, id, normalized)).rejects.toThrow();
    expect(await readdir(root)).toEqual([`${id}.ai.jpg`]);
  });

  it('lists only old managed regular files while leaving unrelated, fresh and linked entries alone', async () => {
    await mkdir(root, { mode: 0o700 });
    const oldKeys = [`${randomUUID()}.jpg`, `${randomUUID()}.ai.jpg`, `${randomUUID()}.display.tmp`, `${randomUUID()}.ai.tmp`, `${randomUUID()}.write.tmp`];
    const oldDate = new Date('2020-01-01');
    for (const key of oldKeys) {
      await writeFile(join(root, key), 'old');
      await utimes(join(root, key), oldDate, oldDate);
    }
    const fresh = `${randomUUID()}.jpg`;
    await writeFile(join(root, fresh), 'fresh');
    await writeFile(join(root, 'untouched.txt'), 'user file');
    await symlink(join(root, oldKeys[0]), join(root, `${randomUUID()}.jpg`));
    await mkdir(join(root, `${randomUUID()}.jpg`));
    expect(await listOrphanCandidates(root, new Date('2021-01-01'))).toEqual([...oldKeys].sort());
    await removeManagedFile(root, oldKeys[0]);
    await removeManagedFile(root, oldKeys[0]);
    expect(await readFile(join(root, fresh), 'utf8')).toBe('fresh');
    expect(await readFile(join(root, 'untouched.txt'), 'utf8')).toBe('user file');
  });

  it('rejects roots with broad permissions', async () => {
    await mkdir(root, { mode: 0o700 });
    await chmod(root, 0o755);
    await expect(writePhotoFiles(root, randomUUID(), normalized)).rejects.toThrow(/0700/);
  });
});
