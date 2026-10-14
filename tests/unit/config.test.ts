import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWithinDirectory, parseServerEnvironment } from '../../src/server/config/environment';
import { validateDatabaseSchema } from '../../src/server/db/connection';

const projectRoot = '/private/tmp/wardrobe-config-test';

describe('server environment', () => {
  it('keeps demo available without AI or PostgreSQL credentials', () => {
    expect(parseServerEnvironment({}, projectRoot)).toEqual({
      aiEnabled: false,
      databaseUrl: undefined,
      databaseSchema: 'public',
      openaiApiKey: undefined,
      fileStorageRoot: resolve(projectRoot, '.data/photos'),
    });
  });

  it('requires the API key only when AI is explicitly enabled', () => {
    expect(() => parseServerEnvironment({ ENABLE_AI: 'true' }, projectRoot))
      .toThrow('OPENAI_API_KEY');
    expect(parseServerEnvironment({ ENABLE_AI: 'true', OPENAI_API_KEY: 'test-only-key' }, projectRoot).aiEnabled)
      .toBe(true);
    expect(parseServerEnvironment({ ENABLE_AI: 'false' }, projectRoot).aiEnabled).toBe(false);
  });

  it('rejects misspelled flags instead of accidentally enabling a paid operation', () => {
    expect(() => parseServerEnvironment({ ENABLE_AI: 'yes' }, projectRoot)).toThrow('ENABLE_AI');
  });

  it('accepts a PostgreSQL URL and private absolute photo directory', () => {
    const databaseUrl = 'postgresql://test-only-user@127.0.0.1:55432/test-only-db';
    expect(parseServerEnvironment({ DATABASE_URL: databaseUrl, FILE_STORAGE_ROOT: '/private/tmp/private-photos' }, projectRoot))
      .toMatchObject({ databaseUrl, fileStorageRoot: '/private/tmp/private-photos' });
  });

  it.each(['https://example.com/secret', 'not-a-url', 'postgresql://localhost'])
    ('rejects an invalid database URL without exposing its value: %s', (databaseUrl) => {
      try {
        parseServerEnvironment({ DATABASE_URL: databaseUrl }, projectRoot);
        expect.fail('invalid URL accepted');
      } catch (error) {
        expect(String(error)).toContain('DATABASE_URL');
        expect(String(error)).not.toContain(databaseUrl);
      }
    });

  it.each(['public/photos', '/private/tmp/wardrobe-config-test/public', '../public/photos', '/', '.', 'photos\u0000'])
    ('rejects public, ambiguous or unsafe photo roots: %s', (fileStorageRoot) => {
      expect(() => parseServerEnvironment({ FILE_STORAGE_ROOT: fileStorageRoot }, projectRoot))
        .toThrow('FILE_STORAGE_ROOT');
    });

  it('does not mutate the supplied environment', () => {
    const environment = Object.freeze({ ENABLE_AI: 'false', DATABASE_URL: '' });
    parseServerEnvironment(environment, projectRoot);
    expect(environment).toEqual({ ENABLE_AI: 'false', DATABASE_URL: '' });
  });

  it('checks directory boundaries rather than a shared string prefix', () => {
    expect(isWithinDirectory('/app/public', '/app/public/photos')).toBe(true);
    expect(isWithinDirectory('/app/public', '/app/public-backup/photos')).toBe(false);
    expect(isWithinDirectory('/app/public', '/app')).toBe(false);
  });

  it('rejects unsafe schema identifiers before they reach PostgreSQL', () => {
    expect(validateDatabaseSchema('wardrobe_test_123')).toBe('wardrobe_test_123');
    expect(() => validateDatabaseSchema('public; DROP SCHEMA public')).toThrow('Invalid database schema');
    expect(() => parseServerEnvironment({ DATABASE_SCHEMA: 'public; DROP TABLE garments' }, projectRoot)).toThrow('DATABASE_SCHEMA');
    expect(parseServerEnvironment({ DATABASE_SCHEMA: 'wardrobe_test_123' }, projectRoot).databaseSchema).toBe('wardrobe_test_123');
  });
});
