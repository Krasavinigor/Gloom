import { readFile, stat } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { z } from 'zod';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { createOperationsRepository } from '../operations/repository';
import { isTerminalStatus } from '../operations/schema';
import { parseRecognitionEvidence } from '../recognition/reconcile';

async function main() {
  const [operationId, evidencePath, ...extra] = process.argv.slice(2);
  if (!evidencePath || extra.length) throw new Error('Use pnpm ai:reconcile <operation-id> <provider-response.json>.');
  z.uuid().parse(operationId);
  const info = await stat(evidencePath);
  if (!info.isFile() || info.size > 65_536) throw new Error('Evidence must be a JSON file up to 64 KiB.');
  const input = JSON.parse(await readFile(evidencePath, 'utf8')) as unknown;
  loadEnvConfig(process.cwd());
  const config = parseServerEnvironment(process.env);
  if (!config.databaseUrl) throw new Error('Database is not configured.');
  const database = createDatabase(config.databaseUrl, config.databaseSchema);
  try {
    const repository = createOperationsRepository(database);
    const operation = await repository.getInternal(operationId);
    if (operation.kind !== 'recognition' || !isTerminalStatus(operation.status) || operation.settlementState !== 'unknown') {
      throw new Error('Only a terminal recognition with unknown settlement can be reconciled.');
    }
    const evidence = parseRecognitionEvidence(input, operation);
    const reference = await database('ai_operations').where({ id: operationId }).select('request_id', 'response_id').first();
    if (!((reference?.request_id && reference.request_id === evidence.requestId)
      || (reference?.response_id && reference.response_id === evidence.responseId))) {
      throw new Error('Provider evidence cannot be linked to this operation; retain the unknown reserve.');
    }
    await repository.finish(operationId, { status: operation.status, ...evidence });
    console.info('Verified usage reconciled. No provider request was made and no result was published.');
  } finally { await database.destroy(); }
}
main().catch(error => {
  console.error(error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'Invalid reconciliation evidence.');
  process.exitCode = 1;
});
