import { describe, expect, it } from 'vitest';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';

describe('integration database selection', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])('permits only a loopback explicit database: %s', (host) => {
    const url = `postgresql://test-only-user@${host}:55432/test-only-db`;
    expect(resolveIntegrationDatabaseUrl(url, undefined)).toBe(url);
  });

  it('rejects an explicit remote URL without exposing its credentials', () => {
    const url = 'postgresql://test-only-user:test-only-credential@example.com/test-only-db';
    try {
      resolveIntegrationDatabaseUrl(url, undefined);
      expect.fail('remote URL accepted');
    } catch (error) {
      expect(String(error)).toContain('INTEGRATION_DATABASE_URL');
      expect(String(error)).not.toContain(url);
      expect(String(error)).not.toContain('test-only-credential');
    }
  });

  it('uses the local application URL when no explicit test URL was supplied', () => {
    const url = 'postgresql://test-only-user@localhost/test-only-db';
    expect(resolveIntegrationDatabaseUrl(undefined, url)).toBe(url);
  });

  it('does not use a remote application URL or invent a database connection', () => {
    expect(resolveIntegrationDatabaseUrl(undefined, 'postgresql://example.com/test-only-db')).toBeUndefined();
    expect(resolveIntegrationDatabaseUrl(undefined, undefined)).toBeUndefined();
  });
});
