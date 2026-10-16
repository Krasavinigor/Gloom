import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvConfig } from '@next/env';
import { parseServerEnvironment } from '../server/config/environment';
import { createDatabase } from '../server/db/connection';
import { createOperationsRepository } from '../server/operations/repository';
import { createOutfitProvider } from '../server/outfits/provider';
import { createOutfitsRepository } from '../server/outfits/repository';
import { runOutfitOnce } from './outfit-worker';
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
    const deps = { workerId: `ai-${randomUUID()}`, repository, context: createRecognitionContext(database, root),
      provider: createRecognitionProvider({ apiKey: config.openaiApiKey }), signal: controller.signal };
    const outfitDeps = { workerId: deps.workerId, repository, context: createOutfitsRepository(database),
      provider: createOutfitProvider({ apiKey: config.openaiApiKey }), signal: controller.signal };
    let recognitionFirst = true;
    let recoveryAt = 0;
    let cleanupAt = 0;
    console.info('AI worker started. Explicitly queued recognition and outfit operations only.');
    while (!controller.signal.aborted) {
      try {
        const now = Date.now();
        if (now >= recoveryAt) { await repository.recover(new Date(now)); recoveryAt = now + 5_000; }
        if (now >= cleanupAt) {
          cleanupAt = now + 60_000;
          try { await wardrobe.cleanup(new Date(now)); }
          catch { console.error('Photo maintenance deferred; AI worker remains available.'); }
        }
        // Alternate the first queue so neither task kind can starve the other.
        const startWithRecognition = recognitionFirst;
        recognitionFirst = !recognitionFirst;
        const first = startWithRecognition ? await runRecognitionOnce(deps) : await runOutfitOnce(outfitDeps);
        const second = startWithRecognition ? await runOutfitOnce(outfitDeps) : await runRecognitionOnce(deps);
        if (!first && !second) await wait(500, controller.signal);
      } catch {
        console.error('AI worker iteration failed; durable operation state retained.');
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
  console.error('AI worker could not start. Check AI settings, database and private photo access.');
  process.exitCode = 1;
});
