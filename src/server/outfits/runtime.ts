import 'server-only';
import type { Knex } from 'knex';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { ApiError } from '../http/api-error';
import { createOperationsRepository } from '../operations/repository';
import { createWeatherService } from '../weather/service';
import { outfitPricing, outfitReserveMicroUsd } from './pricing';
import { createOutfitsRepository } from './repository';
import { createOutfitsService, type OutfitsService } from './service';

type Runtime = { key: string; database: Knex; service: OutfitsService };
const cache = globalThis as typeof globalThis & { outfitsRuntime?: Runtime };
export async function getOutfitsService(): Promise<OutfitsService> {
  const config = parseServerEnvironment(process.env);
  if (!config.databaseUrl) throw new ApiError('DATABASE_UNCONFIGURED', 503, 'Для подбора нужна локальная база данных.');
  const key = JSON.stringify([config.databaseUrl, config.databaseSchema, config.aiEnabled]);
  if (cache.outfitsRuntime?.key !== key) {
    await cache.outfitsRuntime?.database.destroy();
    const database = createDatabase(config.databaseUrl, config.databaseSchema);
    cache.outfitsRuntime = { key, database, service: createOutfitsService({ enabled: config.aiEnabled,
      repository: createOutfitsRepository(database), operations: createOperationsRepository(database),
      weather: createWeatherService(database), pricing: { model: outfitPricing.model,
        revision: outfitPricing.revision, reserveMicroUsd: outfitReserveMicroUsd() } }) };
  }
  return cache.outfitsRuntime.service;
}
