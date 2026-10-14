import { loadEnvConfig } from '@next/env';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { preparePrivateStorage } from '../storage/private-storage';
import { createWardrobeRepository } from '../wardrobe/repository';
import { createWardrobeService } from '../wardrobe/service';

async function main() {
  loadEnvConfig(process.cwd());
  const config = parseServerEnvironment(process.env);
  if (!config.databaseUrl) throw new Error('Database is not configured.');
  const database = createDatabase(config.databaseUrl, config.databaseSchema);
  try {
    const root = await preparePrivateStorage(config.fileStorageRoot);
    const result = await createWardrobeService(createWardrobeRepository(database), root).cleanup();
    console.info('Photo cleanup completed.', result);
    if (result.pending) process.exitCode = 1;
  } finally { await database.destroy(); }
}

main().catch(() => {
  console.error('Photo cleanup failed. Check local database and private folder access.');
  process.exitCode = 1;
});
