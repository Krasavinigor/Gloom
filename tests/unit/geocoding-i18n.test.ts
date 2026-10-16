import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import { createGeocodingService } from '../../src/server/location/geocoding';

it('separates geocoding caches and selection by the search language, defaulting to English', async () => {
  let rows: Record<string, unknown>[] = [];
  const db = (() => ({
    where: (criteria: Record<string, unknown>) => ({ first: async () => rows.find(row => row.cache_key === criteria.cache_key) }),
    insert: (row: Record<string, unknown>) => ({ onConflict: () => ({ merge: async () => { rows = [...rows.filter(other => other.cache_key !== row.cache_key), row]; } }) }),
  })) as unknown as Knex;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
    const language = new URL(String(input)).searchParams.get('language');
    return Response.json({ results: [{ id: 1, name: language === 'ru' ? 'Лондон' : 'London', country_code: 'GB', latitude: 51, longitude: 0, timezone: 'Europe/London' }] });
  });
  const service = createGeocodingService(db, { fetcher });
  expect((await service.search('London'))[0].name).toBe('London');
  expect((await service.search('London', 'ru'))[0].name).toBe('Лондон');
  expect((await service.findCachedPlace('London', '1', 'en'))?.name).toBe('London');
  expect((await service.findCachedPlace('London', '1', 'ru'))?.name).toBe('Лондон');
  await service.search('LONDON', 'en');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects unsupported provider languages and uses the explicit search language over the cookie', async () => {
  const { createLocationHandlers } = await import('../../src/server/http/location-handlers');
  const search = vi.fn().mockResolvedValue([]);
  const handlers = createLocationHandlers(async () => ({ search }) as never);
  const request = (suffix: string) => new Request(`http://127.0.0.1:3000/api/places?query=London${suffix}`, {
    headers: { host: '127.0.0.1:3000', cookie: 'gloom-locale=ru' },
  });
  expect((await handlers.search(request('&locale=en'))).status).toBe(200);
  expect(search).toHaveBeenLastCalledWith('London', 'en');
  expect((await handlers.search(request(''))).status).toBe(200);
  expect(search).toHaveBeenLastCalledWith('London', 'ru');
  expect((await handlers.search(request('&locale=de'))).status).toBe(400);
  expect(search).toHaveBeenCalledTimes(2);
});
