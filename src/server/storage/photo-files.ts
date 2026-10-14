import { constants } from 'node:fs';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedPhoto } from './normalize-photo';
import { preparePrivateStorage } from './private-storage';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_PATTERN}$`);
const PHOTO_KEY = new RegExp(`^${UUID_PATTERN}(?:\\.ai)?\\.jpg$`);
const MANAGED_KEY = new RegExp(`^${UUID_PATTERN}(?:(?:\\.ai)?\\.jpg|\\.(?:display|ai|write)\\.tmp)$`);

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function validateKey(key: string, pattern = MANAGED_KEY): void {
  if (!pattern.test(key)) throw new Error('Invalid managed photo key.');
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error('Photo destination already exists.');
}

async function compensateFiles(paths: readonly string[], cause: unknown): Promise<never> {
  const results = await Promise.allSettled(paths.map((path) => unlink(path)));
  const failures = results.flatMap((result) => result.status === 'rejected' && !isMissing(result.reason) ? [result.reason] : []);
  if (failures.length) throw new AggregateError([cause, ...failures], 'Photo write and compensation failed.');
  throw cause;
}

export async function writePhotoFiles(root: string, id: string, photo: NormalizedPhoto): Promise<Readonly<{key: string; aiKey: string}>> {
  if (!UUID.test(id)) throw new Error('Invalid photo identifier.');
  const directory = await preparePrivateStorage(root);
  const key = `${id}.jpg`;
  const aiKey = `${id}.ai.jpg`;
  const copies = [{ key, temp: `${id}.display.tmp`, bytes: photo.display }, { key: aiKey, temp: `${id}.ai.tmp`, bytes: photo.ai }];
  await Promise.all(copies.map((copy) => assertAbsent(join(directory, copy.key))));
  const claim = join(directory, `${id}.write.tmp`);
  const claimHandle = await open(claim, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let created: readonly string[] = [claim];
  try {
    await claimHandle.close();
    // Recheck after claiming the identifier: another writer may have just completed.
    await Promise.all(copies.map((copy) => assertAbsent(join(directory, copy.key))));
    for (const copy of copies) {
      const temporary = join(directory, copy.temp);
      // Claim the exclusive temporary file before tracking it, so another writer's file is never removed.
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = [...created, temporary];
      try { await handle.writeFile(copy.bytes); await handle.sync(); } finally { await handle.close(); }
    }
    for (const copy of copies) {
      const temporary = join(directory, copy.temp);
      const target = join(directory, copy.key);
      await rename(temporary, target);
      created = [...created.filter((path) => path !== temporary), target];
    }
    await unlink(claim);
    return { key, aiKey };
  } catch (error) {
    return compensateFiles(created, error);
  }
}

export async function readPhotoFile(root: string, key: string): Promise<Buffer> {
  validateKey(key, PHOTO_KEY);
  const directory = await preparePrivateStorage(root);
  const handle = await open(join(directory, key), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Photo is not a regular file.');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function removeManagedFile(root: string, key: string): Promise<void> {
  validateKey(key);
  const directory = await preparePrivateStorage(root);
  const path = join(directory, key);
  try {
    if (!(await lstat(path)).isFile()) throw new Error('Managed photo is not a regular file.');
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function deletePhotoFiles(root: string, key: string, aiKey: string): Promise<void> {
  validateKey(key, PHOTO_KEY);
  validateKey(aiKey, PHOTO_KEY);
  const results = await Promise.allSettled([removeManagedFile(root, key), removeManagedFile(root, aiKey)]);
  const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, 'Photo deletion failed.');
}

export async function listOrphanCandidates(root: string, olderThan: Date): Promise<readonly string[]> {
  const directory = await preparePrivateStorage(root);
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(entries.filter((entry) => entry.isFile() && MANAGED_KEY.test(entry.name)).map(async (entry) => {
    try {
      const metadata = await lstat(join(directory, entry.name));
      return metadata.isFile() && metadata.mtime < olderThan ? entry.name : undefined;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }));
  return candidates.filter((key): key is string => key !== undefined).sort();
}
