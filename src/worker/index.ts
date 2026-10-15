import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvConfig } from '@next/env';
import { parseServerEnvironment } from '../server/config/environment';
import { createDatabase } from '../server/db/connection';
import { createOperationsRepository } from '../server/operations/repository';
import { createRecognitionContext } from '../server/recognition/context';
import { createRecognitionProvider } from '../server/recognition/provider';
import { preparePrivateStorage } from '../server/storage/private-storage';
import { createWardrobeRepository } from '../server/wardrobe/repository';
import { createWardrobeService } from '../server/wardrobe/service';
import { runRecognitionOnce } from './recognition-worker';

async function wait(ms: number, signal: AbortSignal) {
  try { await delay(ms, undefined, { signal }); }
  catch (error) { if (!signal.aborted) throw error; }
}

async function main() {
  loadEnvConfig(process.cwd());
  const config = parseServerEnvironment(process.env);
  if (!config.aiEnabled || !config.openaiApiKey) throw new Error('Enable AI and configure its server key before starting the worker.');
  if (!config.databaseUrl) throw new Error('Database is not configured.');
  const database = createDatabase(config.databaseUrl, config.databaseSchema);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    const root = await preparePrivateStorage(config.fileStorageRoot);
    const repository = createOperationsRepository(database);
    const wardrobe = createWardrobeService(createWardrobeRepository(database), root);
    const deps = { workerId: `recognition-${randomUUID()}`, repository, context: createRecognitionContext(database, root),
      provider: createRecognitionProvider({ apiKey: config.openaiApiKey }), signal: controller.signal };
    let recoveryAt = 0;
    let cleanupAt = 0;
    console.info('Recognition worker started. Explicitly queued operations only.');
    while (!controller.signal.aborted) {
      try {
        const now = Date.now();
        if (now >= recoveryAt) { await repository.recover(new Date(now)); recoveryAt = now + 5_000; }
        if (now >= cleanupAt) {
          cleanupAt = now + 60_000;
          try { await wardrobe.cleanup(new Date(now)); }
          catch { console.error('Photo maintenance deferred; recognition worker remains available.'); }
        }
        if (!await runRecognitionOnce(deps)) await wait(500, controller.signal);
      } catch {
        console.error('Recognition worker iteration failed; durable operation state retained.');
        await wait(1_000, controller.signal);
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await database.destroy();
  }
}

main().catch(() => {
  console.error('Recognition worker could not start. Check AI settings, database and private photo access.');
  process.exitCode = 1;
});
