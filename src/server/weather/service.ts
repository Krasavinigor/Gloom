import type { Knex } from 'knex';
import type { WeatherSnapshot } from '../../features/weather/schema';
import { forecastUrl, normalizeForecast, weatherCacheKey } from './forecast';

type Place = Parameters<typeof forecastUrl>[0];
type CacheRow = Readonly<{ key: string; payload: unknown; fetched_at: Date | string; expires_at: Date | string }>;
type Dependencies = Readonly<{ fetcher?: typeof fetch; clock?: () => number }>;
const CACHE_TTL = 15 * 60_000;

function fromCache(row: CacheRow | undefined, place: Place, now: number, version: number, stale = false): WeatherSnapshot | undefined {
  if (!row) return undefined;
  const fetched = new Date(row.fetched_at).getTime();
  const expires = new Date(row.expires_at).getTime();
  if (!Number.isFinite(fetched) || !Number.isFinite(expires) || fetched > now || expires !== fetched + CACHE_TTL
    || (!stale && now >= expires)) return undefined;
  try {
    return normalizeForecast(row.payload, place, now, stale ? 'stale' : 'fresh', new Date(fetched).toISOString(), version);
  } catch {
    return undefined; // A corrupt/incomplete cached forecast is never exposed; attempt the provider next.
  }
}

function unavailable(place: Place, now: number, version: number): WeatherSnapshot {
  return { status: 'unavailable', locationVersion: version, placeId: String(place.id), fetchedAt: null,
    period: { start: new Date(now).toISOString(), end: new Date(now + 3 * 3600_000).toISOString(), timezone: place.timezone },
    current: null, summary: null, message: 'Не удалось получить погоду. Попробуйте обновить её позже.' };
}

async function fetchForecast(fetcher: typeof fetch, place: Place): Promise<unknown> {
  const response = await fetcher(forecastUrl(place), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('Forecast provider request failed.');
  return response.json();
}

export function createWeatherService(database: Knex, { fetcher = fetch, clock = Date.now }: Dependencies = {}) {
  return {
    async get(place: Place, locationVersion: number): Promise<WeatherSnapshot> {
      const key = weatherCacheKey(place);
      const row = await database<CacheRow>('weather_cache').where({ key }).first();
      const cached = fromCache(row, place, clock(), locationVersion);
      if (cached) return cached;
      let payload: unknown;
      let snapshot: WeatherSnapshot;
      try {
        payload = await fetchForecast(fetcher, place);
        const now = clock();
        snapshot = normalizeForecast(payload, place, now, 'fresh', new Date(now).toISOString(), locationVersion);
      } catch {
        console.warn('Weather provider unavailable or invalid forecast.');
        const now = clock();
        return fromCache(row, place, now, locationVersion, true) ?? unavailable(place, now, locationVersion);
      }
      const fetchedAt = new Date(snapshot.fetchedAt!);
      await database('weather_cache').insert({ key, payload: JSON.stringify(payload), fetched_at: fetchedAt,
        expires_at: new Date(fetchedAt.getTime() + CACHE_TTL) }).onConflict('key').merge();
      return snapshot;
    },
  };
}
