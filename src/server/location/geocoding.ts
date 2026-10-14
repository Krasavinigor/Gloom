import type { Knex } from 'knex';
import { z } from 'zod';
import { placeSchema, searchQuerySchema, type Place } from '../../features/location/schema';
import { ApiError } from '../http/api-error';

const CACHE_DURATION_MS = 86_400_000;
const providerResultSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  admin1: z.string().optional(),
  country: z.string().optional(),
  country_code: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
});
const responseSchema = z.object({
  error: z.literal(false).optional(),
  results: z.array(providerResultSchema).max(8).optional(),
});
const cachePayloadSchema = z.object({ places: z.array(placeSchema).max(8) });
const cacheRowSchema = z.object({
  payload: cachePayloadSchema,
  expires_at: z.date(),
});

function cacheKey(query: string): string {
  return `ru:8:${query.toLocaleLowerCase('ru')}`;
}

async function readCache(db: Knex, query: string, now: number): Promise<Place[] | null> {
  const raw = await db('geocoding_cache').where({ cache_key: cacheKey(query) }).first();
  const cached = cacheRowSchema.safeParse(raw);
  if (!cached.success || cached.data.expires_at.getTime() <= now) return null;
  return cached.data.payload.places;
}

async function fetchPlaces(query: string, fetcher: typeof fetch): Promise<Place[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query, count: '8', language: 'ru', format: 'json' }).toString();
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(5_000), redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) throw new Error('Provider unavailable.');
    const data = responseSchema.parse(await response.json());
    return (data.results ?? []).map((item) => placeSchema.parse({
      id: String(item.id), name: item.name, region: item.admin1 ?? '',
      country: item.country ?? item.country_code, countryCode: item.country_code,
      latitude: item.latitude, longitude: item.longitude, timezone: item.timezone,
    }));
  } catch {
    throw new ApiError('geocoding_unavailable', 503, 'Не удалось найти места. Повторите поиск.');
  }
}

export function createGeocodingService(
  db: Knex,
  { fetcher = fetch, clock = Date.now }: { fetcher?: typeof fetch; clock?: () => number } = {},
) {
  return {
    async search(input: string): Promise<Place[]> {
      const query = searchQuerySchema.parse(input);
      const cached = await readCache(db, query, clock());
      if (cached) return cached;
      const places = await fetchPlaces(query, fetcher);
      const fetchedAt = new Date(clock());
      await db('geocoding_cache').insert({
        cache_key: cacheKey(query), payload: { places }, fetched_at: fetchedAt,
        expires_at: new Date(fetchedAt.getTime() + CACHE_DURATION_MS),
      }).onConflict('cache_key').merge();
      return places;
    },
    async findCachedPlace(input: string, id: string): Promise<Place | null> {
      const query = searchQuerySchema.parse(input);
      const places = await readCache(db, query, clock());
      return places?.find((place) => place.id === id) ?? null;
    },
  };
}
