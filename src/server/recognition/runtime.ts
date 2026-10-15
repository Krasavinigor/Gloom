import 'server-only';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { ApiError } from '../http/api-error';
import type { RecognitionHttpRuntime } from '../http/recognition-handlers';
import { createPgOperationEventHub } from '../operations/events';
import { createOperationsRepository } from '../operations/repository';
import { createRecognitionService } from './service';

type Cache = { key: string; database: Knex; runtime: RecognitionHttpRuntime };
const runtimeGlobal = globalThis as typeof globalThis & { recognitionRuntime?: Cache; recognitionShutdownRegistered?: boolean };
export async function getRecognitionRuntime(): Promise<RecognitionHttpRuntime> {
  const config = parseServerEnvironment(process.env);
  if (!config.databaseUrl) throw new ApiError('DATABASE_UNCONFIGURED', 503, 'Для AI-задач нужна локальная база данных.');
  const key = createHash('sha256').update(JSON.stringify([config.databaseUrl, config.databaseSchema, config.aiEnabled, config.openaiApiKey])).digest('hex');
  if (runtimeGlobal.recognitionRuntime?.key !== key) {
    const previous = runtimeGlobal.recognitionRuntime;
    if (previous) await Promise.all([previous.database.destroy(), previous.runtime.eventHub.dispose()]);
    const database = createDatabase(config.databaseUrl, config.databaseSchema);
    const repository = createOperationsRepository(database);
    runtimeGlobal.recognitionRuntime = { key, database, runtime: {
      repository, recognition: createRecognitionService({ database, repository, enabled: config.aiEnabled }),
      eventHub: createPgOperationEventHub({ connectionString: config.databaseUrl }),
    } };
  }
  if (!runtimeGlobal.recognitionShutdownRegistered) {
    runtimeGlobal.recognitionShutdownRegistered = true;
    const shutdown = () => {
      const current = runtimeGlobal.recognitionRuntime;
      if (current) void Promise.allSettled([current.runtime.eventHub.dispose(), current.database.destroy()]);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
  return runtimeGlobal.recognitionRuntime!.runtime;
}
