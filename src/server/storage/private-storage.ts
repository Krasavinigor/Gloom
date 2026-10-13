import { mkdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isWithinDirectory, validatePhotoRoot } from '../config/environment';

async function resolveExistingAncestors(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await resolveExistingAncestors(parent), basename(path));
  }
}

export async function preparePrivateStorage(root: string, projectRoot = process.cwd()): Promise<string> {
  const validatedRoot = validatePhotoRoot(root, projectRoot);
  const [canonicalRoot, canonicalPublic, canonicalProject] = await Promise.all([
    resolveExistingAncestors(validatedRoot),
    resolveExistingAncestors(resolve(projectRoot, 'public')),
    resolveExistingAncestors(resolve(projectRoot)),
  ]);
  validatePhotoRoot(canonicalRoot, canonicalProject);
  if (isWithinDirectory(canonicalPublic, canonicalRoot)) {
    throw new Error('Invalid FILE_STORAGE_ROOT: public symlinks cannot store private photos.');
  }
  await mkdir(validatedRoot, { recursive: true, mode: 0o700 });
  if (((await stat(validatedRoot)).mode & 0o777) !== 0o700) {
    throw new Error('Invalid FILE_STORAGE_ROOT: use a dedicated photo directory with permissions 0700.');
  }
  return canonicalRoot;
}
