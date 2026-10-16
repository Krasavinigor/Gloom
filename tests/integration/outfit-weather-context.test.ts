import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { normalizeForecast, weatherCacheKey } from '../../src/server/weather/forecast';
import { isWeatherContextCurrent } from '../../src/server/outfits/weather-context';
import { makeForecast, testPlaces } from '../fixtures/providers';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `outfit_weather_${randomUUID().replaceAll('-', '')}`;
const now = Date.now();
const place = testPlaces.moscow;
const payload = makeForecast(now, place.latitude, place.longitude, place.timezone);
const weather = normalizeForecast(payload, place, now, 'fresh', new Date(now).toISOString(), 1);
const snapshot = { place, weather, locationVersion: 1 };
describe.skipIf(!url)('outfit weather gate on actual PostgreSQL cache', () => {
  const admin = url ? createDatabase(url) : null;
  const database = url ? createDatabase(url, schema) : null;
  beforeAll(async () => { await admin!.schema.createSchema(schema); await migrateDatabase(database!, schema); });
  beforeEach(async () => {
    await database!('weather_cache').delete();
    await database!('weather_cache').insert({ key: weatherCacheKey(place), payload: JSON.stringify(payload), fetched_at: new Date(now), expires_at: new Date(now + 900_000) });
  });
  afterAll(async () => { await database!.destroy(); await admin!.schema.dropSchemaIfExists(schema, true); await admin!.destroy(); });
  const gate = (time = now) => database!.transaction(trx => isWeatherContextCurrent(trx, snapshot, new Date(time)));
  it('accepts a fresh snapshot but ignores a newer cache timestamp with unchanged weather facts', async () => {
    expect(await gate()).toBe(true);
    await database!('weather_cache').update({ fetched_at: new Date(now + 1000), expires_at: new Date(now + 901_000) });
    expect(await gate(now + 1000)).toBe(true);
  });
  it('blocks dispatch or publication when rain/cold changes during a pending operation', async () => {
    const changed = { ...payload, current: { ...payload.current, apparent_temperature: -15 },
      hourly: { ...payload.hourly, precipitation: payload.hourly.precipitation.map(() => 10) } };
    await database!('weather_cache').update({ payload: JSON.stringify(changed) });
    expect(await gate()).toBe(false);
  });
  it('blocks expired, missing and corrupt weather instead of refreshing or calling AI', async () => {
    expect(await gate(now + 900_000)).toBe(false);
    await database!('weather_cache').update({ payload: '{}' });
    expect(await gate()).toBe(false);
    await database!('weather_cache').delete();
    expect(await gate()).toBe(false);
  });
  it('checks freshness after waiting for a cache row lock', async () => {
    const blocker = await database!.transaction();
    await blocker('weather_cache').forUpdate().first();
    let time = now;
    const checking = database!.transaction(trx => isWeatherContextCurrent(trx, snapshot, () => new Date(time)));
    time += 900_001;
    await blocker.commit();
    expect(await checking).toBe(false);
  });
});
