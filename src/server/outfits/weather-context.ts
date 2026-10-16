import { isDeepStrictEqual } from 'node:util';
import type { Knex } from 'knex';
import type { Place } from '../../features/location/schema';
import type { WeatherSnapshot } from '../../features/weather/schema';
import { normalizeForecast, weatherCacheKey } from '../weather/forecast';

function facts(weather: WeatherSnapshot) {
  const current = weather.current;
  const summary = weather.summary;
  return { current: current && { temperature: current.temperature, apparentTemperature: current.apparentTemperature,
    weatherCode: current.weatherCode, isDay: current.isDay, windSpeed: current.windSpeed,
    windGusts: current.windGusts, precipitation: current.precipitation },
  summary: summary && { ...summary, precipitationPeriod: undefined } };
}
export const sameWeatherFacts = (left: WeatherSnapshot, right: WeatherSnapshot) => isDeepStrictEqual(facts(left), facts(right));

/** Read-only cache gate. A shared row lock orders cache refresh against dispatch/publication. */
export async function isWeatherContextCurrent(transaction: Knex.Transaction,
  snapshot: { place: Place; weather: WeatherSnapshot; locationVersion: number }, clock: Date | (() => Date)): Promise<boolean> {
  const row = await transaction('weather_cache').where({ key: weatherCacheKey(snapshot.place) }).forShare().first();
  if (!row) return false;
  const now = typeof clock === 'function' ? clock() : clock;
  const fetched = new Date(row.fetched_at).getTime();
  const expires = new Date(row.expires_at).getTime();
  if (!Number.isFinite(fetched) || expires !== fetched + 900_000 || fetched > now.getTime()
    || expires <= now.getTime() || Date.parse(snapshot.weather.period.end) <= now.getTime()) return false;
  try {
    const current = normalizeForecast(row.payload, snapshot.place, Date.parse(snapshot.weather.period.start),
      'fresh', new Date(fetched).toISOString(), snapshot.locationVersion, now.getTime());
    return snapshot.weather.status === 'fresh' && sameWeatherFacts(current, snapshot.weather);
  } catch { return false; }
}
