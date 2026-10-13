import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { getPublicCapabilities } from '../../src/server/config/capabilities';

afterEach(() => vi.unstubAllEnvs());

describe('public capability boundary', () => {
  it('returns only booleans while keeping private configuration on the server', () => {
    vi.stubEnv('ENABLE_AI', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'test-only-private-key');
    vi.stubEnv('DATABASE_URL', 'postgresql://test-only-user@127.0.0.1/test-only-db');
    vi.stubEnv('FILE_STORAGE_ROOT', '.data/photos');
    expect(getPublicCapabilities()).toEqual({ aiEnabled: true, databaseConfigured: true });
  });

  it('keeps the demo available without keys or a database', () => {
    vi.stubEnv('ENABLE_AI', 'false');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('FILE_STORAGE_ROOT', '.data/photos');
    expect(getPublicCapabilities()).toEqual({ aiEnabled: false, databaseConfigured: false });
  });
});
