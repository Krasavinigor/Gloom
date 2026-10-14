import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { getLocalSettings } from '../../src/server/db/settings';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';

const integrationDatabaseUrl = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);

describe.skipIf(!integrationDatabaseUrl)('PostgreSQL migration and persistence', () => {
  it('migrates idempotently, keeps preferences after reconnect, and rolls back only its isolated schema', async () => {
    const schema = `wardrobe_test_${randomUUID().replaceAll('-', '')}`;
    const databaseUrl = integrationDatabaseUrl!;
    const administrator = createDatabase(databaseUrl);
    const database = createDatabase(databaseUrl, schema);
    const reconnected = createDatabase(databaseUrl, schema);

    try {
      await administrator.schema.createSchema(schema);
      await migrateDatabase(database, schema);
      await migrateDatabase(database, schema);
      const settings = await database.raw('SHOW statement_timeout');
      expect(settings.rows[0].statement_timeout).toBe('15s');
      const lockSettings = await database.raw('SHOW lock_timeout');
      expect(lockSettings.rows[0].lock_timeout).toBe('5s');
      expect((await getLocalSettings(database))?.preferences).toEqual({});
      await expect(database('app_settings').insert({ id: 'another-user' })).rejects.toThrow();
      await expect(database('app_settings').where({ id: 'local' }).update({ preferences: '[]' })).rejects.toThrow();
      await database('app_settings').where({ id: 'local' }).update({ preferences: { demoScenario: 'rain' } });
      await database.destroy();
      expect((await getLocalSettings(reconnected))?.preferences).toEqual({ demoScenario: 'rain' });
      await reconnected('app_settings').where({ id: 'local' }).delete();
      expect(await getLocalSettings(reconnected)).toBeUndefined();
      await migrateDatabase(reconnected, schema, 'rollback');
      expect(await reconnected.schema.hasTable('app_settings')).toBe(false);
    } finally {
      await database.destroy();
      await reconnected.destroy();
      await administrator.schema.dropSchemaIfExists(schema, true);
      await administrator.destroy();
    }
  });
});
