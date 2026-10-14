import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createWeatherService } from '../../src/server/weather/service';
import { weatherCacheKey } from '../../src/server/weather/forecast';
import * as migration from '../../db/migrations/202610140003_weather_cache';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const now = Date.parse('2026-10-25T00:30:00Z');
const place = { id: '2643743', name: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London' };
function fixture() {
  const values = Array(12).fill(10);
  const units = { time: 'unixtime', temperature_2m: '°C', apparent_temperature: '°C', precipitation: 'mm', weather_code: 'wmo code', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h' };
  return { latitude: place.latitude, longitude: place.longitude, timezone: place.timezone, current_units: { ...units, interval: 'seconds', is_day: '' }, hourly_units: { ...units, precipitation_probability: '%' },
    current: { time: now / 1000, interval: 900, temperature_2m: 10, apparent_temperature: 10, precipitation: 0, weather_code: 3, is_day: 1, wind_speed_10m: 10, wind_gusts_10m: 10 },
    hourly: { time: values.map((_, i) => now / 1000 - 1800 + i * 3600), temperature_2m: values, apparent_temperature: values, wind_speed_10m: values, wind_gusts_10m: values, precipitation: values, precipitation_probability: values, weather_code: Array(12).fill(3) } };
}

describe.skipIf(!url)('PostgreSQL weather cache', () => {
  it('persists validated forecast across reconnect, preserves expired data on failure, and constrains rows', async () => {
    const schema = `weather_test_${randomUUID().replaceAll('-', '')}`;
    const admin = createDatabase(url!);
    const database = createDatabase(url!, schema);
    const reconnected = createDatabase(url!, schema);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await admin.schema.createSchema(schema);
      await migration.up(database);
      let time = now;
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture()));
      expect((await createWeatherService(database, { fetcher, clock: () => time }).get(place, 1)).status).toBe('fresh');
      await database.destroy();
      const service = createWeatherService(reconnected, { fetcher, clock: () => time });
      expect((await service.get(place, 7)).locationVersion).toBe(7);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const initial = await reconnected('weather_cache').where({ key: weatherCacheKey(place) }).first();
      expect(initial.payload.current.temperature_2m).toBe(10);
      expect(initial.expires_at.getTime() - initial.fetched_at.getTime()).toBe(900_000);
      time += 3600_000;
      fetcher.mockRejectedValue(new Error('offline'));
      expect((await service.get(place, 8)).status).toBe('stale');
      expect(await reconnected('weather_cache').where({ key: weatherCacheKey(place) }).first()).toEqual(initial);
      await expect(reconnected('weather_cache').insert({ key: 'invalid', payload: {}, fetched_at: new Date(now), expires_at: new Date(now + 900_000) })).rejects.toThrow();
      await expect(reconnected('weather_cache').where({ key: initial.key }).update({ payload: '[]' })).rejects.toThrow();
      await expect(reconnected('weather_cache').where({ key: initial.key }).update({ expires_at: new Date(now - 1) })).rejects.toThrow();
      await migration.down(reconnected);
      expect(await reconnected.schema.hasTable('weather_cache')).toBe(false);
    } finally {
      warn.mockRestore();
      await database.destroy();
      await reconnected.destroy();
      await admin.schema.dropSchemaIfExists(schema, true);
      await admin.destroy();
    }
  });
});
