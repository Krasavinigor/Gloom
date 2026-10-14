import type { Knex } from 'knex';
import * as appSettings from '../../../db/migrations/202610130001_app_settings';
import * as wardrobe from '../../../db/migrations/202610140001_wardrobe';
import { validateDatabaseSchema } from './connection';

const migrations = [
  { name: '202610130001_app_settings', implementation: appSettings },
  { name: '202610140001_wardrobe', implementation: wardrobe },
] as const;
type Migration = (typeof migrations)[number];

export async function migrateDatabase(
  database: Knex,
  schema = 'public',
  direction: 'latest' | 'rollback' = 'latest',
): Promise<void> {
  const configuration: Knex.MigratorConfig = {
    schemaName: validateDatabaseSchema(schema),
    tableName: 'knex_migrations',
    migrationSource: {
      getMigrations: async () => [...migrations],
      getMigrationName: (entry: Migration) => entry.name,
      getMigration: async (entry: Migration) => entry.implementation,
    },
  };
  if (direction === 'rollback') {
    await database.migrate.rollback(configuration);
  } else {
    await database.migrate.latest(configuration);
  }
}
