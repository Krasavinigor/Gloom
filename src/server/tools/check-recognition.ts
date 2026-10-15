import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { createOperationsRepository } from '../operations/repository';
import { createRecognitionContext } from '../recognition/context';
import { createRecognitionProvider } from '../recognition/provider';
import { createRecognitionService } from '../recognition/service';
import { preparePrivateStorage } from '../storage/private-storage';
import { createWardrobeRepository } from '../wardrobe/repository';
import { createWardrobeService } from '../wardrobe/service';
import { runRecognitionOnce } from '../../worker/recognition-worker';

/** Explicit paid smoke check; uses the real retained ledger, never a disposable budget. */
async function main() {
  const [photoPath, ...extra] = process.argv.slice(2);
  if (!photoPath || extra.length) throw new Error('Use pnpm check:recognition <photo-path>.');
  const info = await stat(photoPath);
  if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Use a JPEG/PNG/WebP photo up to 10 MiB.');
  loadEnvConfig(process.cwd());
  const config = parseServerEnvironment(process.env);
  if (!config.aiEnabled || !config.openaiApiKey || !config.databaseUrl) throw new Error('Enable AI and configure its key and local database.');
  const database = createDatabase(config.databaseUrl, config.databaseSchema);
  const operations = createOperationsRepository(database);
  const root = await preparePrivateStorage(config.fileStorageRoot);
  const wardrobe = createWardrobeService(createWardrobeRepository(database), root);
  let draftId: string | undefined;
  let operationId: string | undefined;
  try {
    const draft = await wardrobe.upload(await readFile(photoPath));
    draftId = draft.id;
    const service = createRecognitionService({ enabled: true, database, repository: operations });
    const operation = await service.start(draft.id, randomUUID());
    operationId = operation.id;
    // This tool owns only its admitted draft; it must not consume another user's queued task.
    const scoped = { ...operations, claim: async (worker: string, options: { now: Date; leaseMs: number }) => {
      return operations.claim(worker, { ...options, operationId: operation.id });
    } };
    await runRecognitionOnce({ workerId: `live-check-${randomUUID()}`, repository: scoped,
      context: createRecognitionContext(database, root), provider: createRecognitionProvider({ apiKey: config.openaiApiKey }) });
    const completed = await operations.get(operation.id);
    const proposal = (await wardrobe.getDraft(draft.id)).aiProposal;
    const ledger = await database('ai_cost_ledger').where({ operation_id: operation.id }).first();
    console.info('Live recognition check:', { operationId: operation.id, status: completed.status,
      proposalKind: proposal?.kind ?? null, settlement: completed.settlementState,
      costMicroUsd: ledger?.confirmed_micro_usd ?? null, usage: ledger?.usage ?? null });
    if (completed.status !== 'succeeded') throw new Error('Recognition did not succeed; ledger retained for diagnosis.');
  } finally {
    try {
      if (operationId) {
        const current = await operations.get(operationId);
        if (['queued', 'running'].includes(current.status)) await operations.finish(operationId, { status: 'interrupted', errorCode: 'CHECK_STOPPED' });
      }
      if (draftId) { await wardrobe.cancelDraft(draftId); await wardrobe.cleanup(); }
    } finally { await database.destroy(); }
  }
}
main().catch(() => {
  console.error('Live recognition check failed. No automatic retry; inspect the retained operation and budget.');
  process.exitCode = 1;
});
