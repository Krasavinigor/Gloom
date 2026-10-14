import type { Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWeatherService } from '../../src/server/weather/service';

const now = Date.parse('2026-10-25T00:30:00Z');
const place = { id: '2643743', name: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London' };
function fixture() {
  const values = Array(12).fill(10);
  const units = { time: 'unixtime', temperature_2m: '°C', apparent_temperature: '°C', precipitation: 'mm', weather_code: 'wmo code', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h' };
  return { latitude: place.latitude, longitude: place.longitude, timezone: place.timezone, current_units: { ...units, interval: 'seconds', is_day: '' }, hourly_units: { ...units, precipitation_probability: '%' },
    current: { time: now / 1000, interval: 900, temperature_2m: 10, apparent_temperature: 10, precipitation: 0, weather_code: 3, is_day: 1, wind_speed_10m: 10, wind_gusts_10m: 10 },
    hourly: { time: values.map((_, i) => now / 1000 - 1800 + i * 3600), temperature_2m: values, apparent_temperature: values, wind_speed_10m: values, wind_gusts_10m: values, precipitation: values, precipitation_probability: values, weather_code: Array(12).fill(3) } };
}
function memoryDatabase() {
  let record: Record<string, unknown> | undefined;
  const save = vi.fn(async (data: Record<string, unknown>) => { record = { ...data, payload: typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload }; });
  const database = vi.fn(() => ({
    where: () => ({ first: async () => record }),
    insert: (data: Record<string, unknown>) => ({ onConflict: () => ({ merge: async () => save(data) }) }),
  }));
  return { database: database as unknown as Knex, save, record: () => record, seed: (value: Record<string, unknown>) => { record = value; } };
}
afterEach(() => vi.restoreAllMocks());

describe('forecast cache service', () => {
  it('caches validated payload15min and recomputes window/version on reads without changing timestamp', async () => {
    const store = memoryDatabase();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture()));
    let time = now;
    const service = createWeatherService(store.database, { fetcher, clock: () => time });
    const first = await service.get(place, 1);
    time += 14 * 60_000;
    const second = await service.get({ ...place, name: 'Other name', id: 'new' }, 2);
    expect(first.status).toBe('fresh');
    expect(second.status).toBe('fresh');
    expect(second.placeId).toBe('new');
    expect(second.locationVersion).toBe(2);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.period.start).toBe(new Date(time).toISOString());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
    time = now + 15 * 60_000;
    expect((await service.get(place, 2)).status).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['network', 'http', 'units'])('returns explicitly stale cached forecast on %s error without overwriting it', async (failure) => {
    const store = memoryDatabase();
    let time = now;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture()));
    const service = createWeatherService(store.database, { fetcher, clock: () => time });
    await service.get(place, 1);
    const initialRecord = store.record();
    time += 60 * 60_000;
    if (failure === 'network') fetcher.mockRejectedValueOnce(new Error('Provider sensitive body'));
    else if (failure === 'http') fetcher.mockResolvedValueOnce(new Response('Sensitive provider message', { status: 429 }));
    else fetcher.mockResolvedValueOnce(Response.json({ ...fixture(), hourly_units: {} }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await service.get(place, 2);
    expect(result.status).toBe('stale');
    expect(result.fetchedAt).toBe(new Date(now).toISOString());
    expect(result.summary).not.toBeNull();
    expect(result.message).not.toContain('sensitive');
    expect(store.record()).toEqual(initialRecord);
    expect(warn).toHaveBeenCalled();
  });
  it('returns unavailable if cache does not cover requested future window', async () => {
    const store = memoryDatabase();
    let time = now;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture()));
    const service = createWeatherService(store.database, { fetcher, clock: () => time });
    await service.get(place, 1);
    time += 11 * 3600_000;
    fetcher.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await service.get(place, 3)).toMatchObject({ status: 'unavailable', current: null, summary: null });
  });
  it('does not trust corrupt/future cache rows, reports unavailable on first failure, and never caches invalid data', async () => {
    const store = memoryDatabase();
    store.seed({ payload: fixture(), fetched_at: new Date(now + 3600_000), expires_at: new Date(now + 7200_000) });
    const fetcher = vi.fn(async () => Response.json({}));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createWeatherService(store.database, { fetcher, clock: () => now });
    expect((await service.get(place, 1)).status).toBe('unavailable');
    expect(store.save).not.toHaveBeenCalled();
    store.seed({ payload: {}, fetched_at: 'invalid', expires_at: 'invalid' });
    expect((await service.get(place, 1)).status).toBe('unavailable');
  });
  it('propagates database errors rather than incorrectly labelling them provider failures', async () => {
    const database = vi.fn(() => ({ where: () => ({ first: async () => { throw new Error('Database unavailable'); } }) })) as unknown as Knex;
    await expect(createWeatherService(database, { clock: () => now }).get(place, 1)).rejects.toThrow('Database unavailable');
  });
});
