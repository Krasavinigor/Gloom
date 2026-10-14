import { loadEnvConfig } from '@next/env';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { migrateDatabase } from '../db/migrations';
import { getLocalSettings } from '../db/settings';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const configuration = parseServerEnvironment(process.env);
  if (!configuration.databaseUrl) throw new Error('DATABASE_URL is required for migrations.');
  const database = createDatabase(configuration.databaseUrl, configuration.databaseSchema);
  try {
    await migrateDatabase(database, configuration.databaseSchema);
    if (!await getLocalSettings(database)) throw new Error('Local settings were not initialized.');
    console.info('Database migrations completed; local settings are ready.');
  } finally {
    await database.destroy();
  }
}

main().catch(() => {
  console.error('Migration failed. Check the server environment and PostgreSQL availability.');
  process.exitCode = 1;
});
