import 'server-only';
import type { Knex } from 'knex';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { ApiError } from '../http/errors';
import { preparePrivateStorage } from '../storage/private-storage';
import { createWardrobeRepository } from './repository';
import { createWardrobeService, type WardrobeService } from './service';

type RuntimeCache = { key: string; database: Knex; service: Promise<WardrobeService> };
const runtimeGlobal = globalThis as typeof globalThis & { wardrobeRuntime?: RuntimeCache };

export async function getWardrobeService(): Promise<WardrobeService> {
  const config = parseServerEnvironment(process.env);
  if (!config.databaseUrl) throw new ApiError('database_unconfigured', 503, 'Для личного гардероба нужно настроить и запустить локальную базу данных.');
  const key = JSON.stringify([config.databaseUrl, config.databaseSchema, config.fileStorageRoot]);
  if (!runtimeGlobal.wardrobeRuntime || runtimeGlobal.wardrobeRuntime.key !== key) {
    const previous = runtimeGlobal.wardrobeRuntime;
    const database = createDatabase(config.databaseUrl, config.databaseSchema);
    const service = Promise.resolve(previous?.database.destroy()).then(() => preparePrivateStorage(config.fileStorageRoot)).then(root =>
      createWardrobeService(createWardrobeRepository(database), root),
    ).catch(async error => {
      await database.destroy();
      if (runtimeGlobal.wardrobeRuntime?.key === key) runtimeGlobal.wardrobeRuntime = undefined;
      throw error;
    });
    runtimeGlobal.wardrobeRuntime = { key, database, service };
  }
  return runtimeGlobal.wardrobeRuntime.service;
}
