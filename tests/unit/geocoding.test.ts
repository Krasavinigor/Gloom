import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { createGeocodingService } from '../../src/server/location/geocoding';

const providerPlace = {
  id: 524901, name: 'Москва', admin1: 'Москва', country: 'Россия', country_code: 'RU',
  latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow', population: 123456,
};
const now = Date.parse('2026-10-14T10:00:00Z');
function cacheDatabase() {
  let rows: Record<string, unknown>[] = [];
  return ((table: string) => {
    expect(table).toBe('geocoding_cache');
    return {
      where: (criteria: Record<string, unknown>) => ({
        first: async () => rows.find((row) => Object.entries(criteria).every(([key, value]) => row[key] === value)),
      }),
      insert: (row: Record<string, unknown>) => ({
        onConflict: () => ({ merge: async () => { rows = [...rows.filter((other) => other.cache_key !== row.cache_key), row]; } }),
      }),
    };
  }) as unknown as Knex;
}

describe('geocoding provider and 24-hour cache', () => {
  it('uses a fixed URL, validated results and normalized cache keys', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ results: [providerPlace] }));
    const db = cacheDatabase();
    const service = createGeocodingService(db, { fetcher, clock: () => now });
    const places = await service.search('  Москва  ');
    expect(places).toEqual([{
      id: '524901', name: 'Москва', region: 'Москва', country: 'Россия', countryCode: 'RU',
      latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow',
    }]);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://geocoding-api.open-meteo.com/v1/search?name=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0&count=8&language=ru&format=json');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(await service.search('МОСКВА')).toEqual(places);
    expect(await service.findCachedPlace('москва', '524901')).toEqual(places[0]);
    expect(await service.findCachedPlace('москва', 'unknown')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const expired = createGeocodingService(db, { fetcher, clock: () => now + 86_400_001 });
    expect(await expired.findCachedPlace('Москва', '524901')).toBeNull();
    await expired.search('Москва');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('supports no results and a missing administrative region or country name', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ results: [{ ...providerPlace, admin1: undefined, country: undefined }] }))
      .mockResolvedValueOnce(Response.json({ generationtime_ms: 1 }));
    const service = createGeocodingService(cacheDatabase(), { fetcher, clock: () => now });
    expect((await service.search('Москва'))[0]).toMatchObject({ region: '', country: 'RU' });
    expect(await service.search('Nothing')).toEqual([]);
    expect(await service.findCachedPlace('new query', 'id')).toBeNull();
  });
  it('rejects invalid provider data, status errors and network timeouts with a safe message', async () => {
    for (const value of [
      Response.json({ results: [{ ...providerPlace, latitude: 150 }] }),
      Response.json({ results: [{ ...providerPlace, timezone: 'bad-zone' }] }),
      Response.json({ error: true, reason: 'provider internals' }),
      Response.json({}, { status: 503 }),
      new Response('invalid json'),
    ]) {
      const service = createGeocodingService(cacheDatabase(), { fetcher: vi.fn().mockResolvedValue(value) });
      await expect(service.search('Москва')).rejects.toMatchObject({ code: 'geocoding_unavailable', status: 503 });
    }
    const service = createGeocodingService(cacheDatabase(), { fetcher: vi.fn().mockRejectedValue(new Error('secret network details')) });
    await expect(service.search('Москва')).rejects.toThrow('Не удалось найти места. Повторите поиск.');
  });
  it('does not call a provider for invalid queries or trust a corrupted cached payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ results: [providerPlace] }));
    const db = cacheDatabase();
    const service = createGeocodingService(db, { fetcher, clock: () => now });
    await expect(service.search('x')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await service.search('Москва');
    await db('geocoding_cache').insert({ cache_key: 'ru:8:москва', payload: { places: [{ bad: true }] }, expires_at: new Date(now + 10000) }).onConflict('cache_key').merge();
    expect(await service.findCachedPlace('Москва', '524901')).toBeNull();
    expect((await service.search('Москва'))[0].id).toBe('524901');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
