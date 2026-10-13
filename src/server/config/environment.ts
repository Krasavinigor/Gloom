import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const optionalValue = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().optional(),
);

const environmentSchema = z.object({
  ENABLE_AI: z.enum(['true', 'false']).default('false'),
  OPENAI_API_KEY: optionalValue,
  DATABASE_URL: optionalValue,
  FILE_STORAGE_ROOT: z.string().default('.data/photos'),
});

export type ServerEnvironment = Readonly<{
  aiEnabled: boolean;
  openaiApiKey: string | undefined;
  databaseUrl: string | undefined;
  fileStorageRoot: string;
}>;

export function isWithinDirectory(directory: string, candidate: string): boolean {
  const path = relative(directory, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function validatePhotoRoot(value: string, projectRoot: string): string {
  const root = resolve(projectRoot, value);
  const unsafePath = !value.trim() || value.includes('\0') || value.includes('\\')
    || value.split('/').includes('..') || isWithinDirectory(root, resolve(projectRoot))
    || root === resolve('/') || isWithinDirectory(resolve(projectRoot, 'public'), root);
  if (unsafePath) throw new Error('Invalid FILE_STORAGE_ROOT: use a private directory outside public.');
  return root;
}

export function validateDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname
      || url.pathname.length < 2 || url.hash) throw new Error('Invalid URL');
    return value;
  } catch {
    throw new Error('Invalid DATABASE_URL: use a PostgreSQL connection URL with a database name.');
  }
}

export function parseServerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  projectRoot = process.cwd(),
): ServerEnvironment {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))].join(', ');
    throw new Error(`Invalid server configuration: ${fields}.`);
  }
  const { ENABLE_AI, OPENAI_API_KEY, DATABASE_URL, FILE_STORAGE_ROOT } = result.data;
  if (ENABLE_AI === 'true' && (!OPENAI_API_KEY || /\s/.test(OPENAI_API_KEY))) {
    throw new Error('OPENAI_API_KEY is required when ENABLE_AI=true.');
  }
  return {
    aiEnabled: ENABLE_AI === 'true',
    openaiApiKey: OPENAI_API_KEY,
    databaseUrl: DATABASE_URL ? validateDatabaseUrl(DATABASE_URL) : undefined,
    fileStorageRoot: validatePhotoRoot(FILE_STORAGE_ROOT, projectRoot),
  };
}
