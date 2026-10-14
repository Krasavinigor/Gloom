import 'server-only';
import type { Knex } from 'knex';
import { parseServerEnvironment } from '../config/environment';
import { createDatabase } from '../db/connection';
import { ApiError } from '../http/api-error';
import { createWeatherService } from '../weather/service';
import { createGeocodingService } from './geocoding';
import { createLocationRepository } from './repository';
import { createLocationWeatherService, type LocationWeatherService } from './service';

type RuntimeCache = { key: string; database: Knex; service: Promise<LocationWeatherService> };
const runtimeGlobal = globalThis as typeof globalThis & { locationWeatherRuntime?: RuntimeCache };

export async function getLocationWeatherService(): Promise<LocationWeatherService> {
  const config = parseServerEnvironment(process.env);
  if (!config.databaseUrl) throw new ApiError('database_unconfigured', 503, 'Для сохранения места нужно настроить и запустить локальную базу данных.');
  const key = JSON.stringify([config.databaseUrl, config.databaseSchema]);
  if (!runtimeGlobal.locationWeatherRuntime || runtimeGlobal.locationWeatherRuntime.key !== key) {
    const previous = runtimeGlobal.locationWeatherRuntime;
    const database = createDatabase(config.databaseUrl, config.databaseSchema);
    const service = Promise.resolve(previous?.database.destroy()).then(() =>
      createLocationWeatherService(createLocationRepository(database), createGeocodingService(database), createWeatherService(database)),
    );
    runtimeGlobal.locationWeatherRuntime = { key, database, service };
  }
  return runtimeGlobal.locationWeatherRuntime.service;
}
