import type { Knex } from 'knex';
import * as appSettings from '../../../db/migrations/202610130001_app_settings';
import { validateDatabaseSchema } from './connection';

const migration = { name: '202610130001_app_settings', implementation: appSettings } as const;

export async function migrateDatabase(
  database: Knex,
  schema = 'public',
  direction: 'latest' | 'rollback' = 'latest',
): Promise<void> {
  const configuration: Knex.MigratorConfig = {
    schemaName: validateDatabaseSchema(schema),
    tableName: 'knex_migrations',
    migrationSource: {
      getMigrations: async () => [migration],
      getMigrationName: (entry: typeof migration) => entry.name,
      getMigration: async (entry: typeof migration) => entry.implementation,
    },
  };
  if (direction === 'rollback') {
    await database.migrate.rollback(configuration);
  } else {
    await database.migrate.latest(configuration);
  }
}
