import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Place as ForecastPlace } from '../../features/location/schema';
import type { WeatherSnapshot } from '../../features/weather/schema';

const temperature = z.number().min(-100).max(100);
const wind = z.number().min(0).max(500);
const precipitation = z.number().min(0).max(500);
const probability = z.number().min(0).max(100);
const timestamp = z.number().int().positive();
const weatherCode = z.number().int().refine((code) => [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99].includes(code));
const array = (schema: z.ZodType<number>) => z.array(schema).min(4).max(192);
const units = {
  time: z.literal('unixtime'), temperature_2m: z.literal('°C'), apparent_temperature: z.literal('°C'),
  precipitation: z.literal('mm'), weather_code: z.literal('wmo code'),
  wind_speed_10m: z.literal('km/h'), wind_gusts_10m: z.literal('km/h'),
};
const responseSchema = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: z.string(),
  current_units: z.object({ ...units, interval: z.literal('seconds'), is_day: z.literal('') }),
  hourly_units: z.object({ ...units, precipitation_probability: z.literal('%') }),
  current: z.object({ time: timestamp, interval: z.number().int().min(1).max(3600), temperature_2m: temperature,
    apparent_temperature: temperature, precipitation, weather_code: weatherCode, is_day: z.union([z.literal(0), z.literal(1)]),
    wind_speed_10m: wind, wind_gusts_10m: wind }),
  hourly: z.object({ time: array(timestamp), temperature_2m: array(temperature), apparent_temperature: array(temperature),
    precipitation: array(precipitation), precipitation_probability: array(probability), weather_code: array(weatherCode),
    wind_speed_10m: array(wind), wind_gusts_10m: array(wind) }),
});
type Forecast = z.infer<typeof responseSchema>;
const HOUR = 3600;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const canonicalTimezone = (value: string) => new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;

export function forecastUrl(place: ForecastPlace): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  const fields = ['temperature_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_gusts_10m', 'precipitation', 'weather_code'];
  url.search = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude),
    timezone: place.timezone, timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
    past_days: '1', forecast_days: '3', current: [...fields, 'is_day'].join(','), hourly: [...fields, 'precipitation_probability'].join(',') }).toString();
  return url;
}
export function weatherCacheKey(place: ForecastPlace): string {
  return createHash('sha256').update(forecastUrl(place).href).digest('hex');
}

function validateCoverage(raw: unknown, place: ForecastPlace, start: number, status: 'fresh' | 'stale'): Forecast {
  const forecast = responseSchema.parse(raw);
  if (canonicalTimezone(forecast.timezone) !== canonicalTimezone(place.timezone)
    || Math.abs(forecast.latitude - place.latitude) > 1 || Math.abs(forecast.longitude - place.longitude) > 1) throw new Error('Forecast location mismatch.');
  const times = forecast.hourly.time;
  if (Object.values(forecast.hourly).some((values) => values.length !== times.length)
    || times.some((time, index) => index > 0 && time - times[index - 1] !== HOUR)
    || times[0] > start || times[times.length - 1] < start + 3 * HOUR) throw new Error('Incomplete hourly coverage.');
  if (forecast.current.time > start + 300 || (status === 'fresh' && start - forecast.current.time > 2700)
    || start - forecast.current.time > 86400) throw new Error('Invalid current forecast time.');
  return forecast;
}

function instantValues(times: number[], values: number[], start: number, end: number): number[] {
  const boundary = (time: number) => {
    const right = times.findIndex((point) => point >= time);
    if (times[right] === time) return values[right];
    const left = right - 1;
    const fraction = (time - times[left]) / (times[right] - times[left]);
    return values[left] + (values[right] - values[left]) * fraction;
  };
  // Hourly instantaneous values bracket the requested period. Linear boundary estimates
  // avoid treating an earlier/later hour's full value as an extremum inside that period.
  return [boundary(start), ...times.flatMap((time, index) => time > start && time < end ? [values[index]] : []), boundary(end)];
}

function summarize(forecast: Forecast, start: number): WeatherSnapshot['summary'] {
  const end = start + 3 * HOUR;
  const hourly = forecast.hourly;
  const points = (values: number[]) => instantValues(hourly.time, values, start, end);
  const intervalIndexes = hourly.time.flatMap((time, index) => time > start && time - HOUR < end ? [index] : []);
  const intervals = (values: number[]) => intervalIndexes.map((index) => values[index]);
  return {
    temperature: { min: Math.min(...points(hourly.temperature_2m)), max: Math.max(...points(hourly.temperature_2m)) },
    apparentTemperature: { min: Math.min(...points(hourly.apparent_temperature)), max: Math.max(...points(hourly.apparent_temperature)) },
    windSpeedMax: Math.max(...points(hourly.wind_speed_10m)),
    windGustsMax: Math.max(...intervals(hourly.wind_gusts_10m)),
    precipitationMm: Math.round(intervals(hourly.precipitation).reduce((total, value) => total + value, 0) * 100) / 100,
    precipitationProbabilityMax: Math.max(...intervals(hourly.precipitation_probability)),
    precipitationPeriod: { start: iso(hourly.time[intervalIndexes[0]] - HOUR), end: iso(hourly.time[intervalIndexes[intervalIndexes.length - 1]]) },
  };
}

export function normalizeForecast(raw: unknown, place: ForecastPlace, now: number, status: 'fresh' | 'stale', fetchedAt: string, locationVersion: number): WeatherSnapshot {
  const start = now / 1000;
  const forecast = validateCoverage(raw, place, start, status);
  const current = forecast.current;
  return {
    status, locationVersion, placeId: String(place.id), fetchedAt,
    period: { start: iso(start), end: iso(start + 3 * HOUR), timezone: place.timezone },
    current: { time: iso(current.time), intervalSeconds: current.interval, temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature, weatherCode: current.weather_code, isDay: current.is_day === 1,
      windSpeed: current.wind_speed_10m, windGusts: current.wind_gusts_10m, precipitation: current.precipitation },
    summary: summarize(forecast, start),
    message: status === 'stale' ? 'Не удалось обновить погоду. Показан сохранённый прогноз; подбор пока недоступен.' : null,
  };
}
