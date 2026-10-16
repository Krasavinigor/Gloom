import type { Knex } from 'knex';
import * as appSettings from '../../../db/migrations/202610130001_app_settings';
import * as wardrobe from '../../../db/migrations/202610140001_wardrobe';
import * as location from '../../../db/migrations/202610140002_location';
import * as weatherCache from '../../../db/migrations/202610140003_weather_cache';
import * as aiOperations from '../../../db/migrations/202610150001_ai_operations';
import * as outfitResult from '../../../db/migrations/202610160001_outfit_result';
import { validateDatabaseSchema } from './connection';

const migrations = [
  { name: '202610130001_app_settings', implementation: appSettings },
  { name: '202610140001_wardrobe', implementation: wardrobe },
  { name: '202610140002_location', implementation: location },
  { name: '202610140003_weather_cache', implementation: weatherCache },
  { name: '202610150001_ai_operations', implementation: aiOperations },
  { name: '202610160001_outfit_result', implementation: outfitResult },
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
