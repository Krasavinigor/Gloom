import { describe, expect, it } from 'vitest';
import { weatherSnapshotSchema } from '../../src/features/weather/schema';
import { normalizeForecast, weatherCacheKey, forecastUrl } from '../../src/server/weather/forecast';

const place = { id: '2643743', name: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London' };
const now = Date.parse('2026-10-25T00:30:00Z');
const fixture = (start = now - 30 * 60_000, count = 8) => ({
  latitude: 51.5, longitude: -0.125, timezone: place.timezone,
  current_units: { time: 'unixtime', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C', precipitation: 'mm', weather_code: 'wmo code', is_day: '', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h' },
  hourly_units: { time: 'unixtime', temperature_2m: '°C', apparent_temperature: '°C', precipitation: 'mm', precipitation_probability: '%', weather_code: 'wmo code', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h' },
  current: { time: now / 1000 - 15 * 60, interval: 900, temperature_2m: 12, apparent_temperature: 9, precipitation: 0.3, weather_code: 3, is_day: 0, wind_speed_10m: 15, wind_gusts_10m: 22 },
  hourly: { time: Array.from({ length: count }, (_, i) => start / 1000 + i * 3600), temperature_2m: Array.from({ length: count }, (_, i) => 10 + i), apparent_temperature: Array.from({ length: count }, (_, i) => 7 + i), precipitation: Array.from({ length: count }, (_, i) => i === 4 ? 0 : 1), precipitation_probability: Array.from({ length: count }, (_, i) => 10 * i), weather_code: Array(count).fill(3), wind_speed_10m: Array.from({ length: count }, (_, i) => 10 + i), wind_gusts_10m: Array.from({ length: count }, (_, i) => 20 + i) },
});
const normalize = (raw: unknown, time = now, status: 'fresh' | 'stale' = 'fresh') => normalizeForecast(raw, place, time, status, new Date(now).toISOString(), 4);

describe('Open-Meteo forecast normalization', () => {
  it('accepts the documented heavy-thunderstorm code in current and hourly data', () => {
    const raw = fixture();
    const result = normalize({ ...raw, current: { ...raw.current, weather_code: 97 },
      hourly: { ...raw.hourly, weather_code: raw.hourly.weather_code.map(() => 97) } });
    expect(result.current?.weatherCode).toBe(97);
    expect(result.status).toBe('fresh');
  });
  it('uses UTC three-hour window across repeated local DST hour, estimates instantaneous boundaries and conservatively includes rain intervals', () => {
    const result = normalize(fixture());
    expect(result.period).toEqual({ start: '2026-10-25T00:30:00.000Z', end: '2026-10-25T03:30:00.000Z', timezone: place.timezone });
    expect(result.summary).toEqual({ temperature: { min: 10.5, max: 13.5 }, apparentTemperature: { min: 7.5, max: 10.5 }, windSpeedMax: 13.5, windGustsMax: 24, precipitationMm: 3, precipitationProbabilityMax: 40, precipitationPeriod: { start: '2026-10-25T00:00:00.000Z', end: '2026-10-25T04:00:00.000Z' } });
    expect(weatherSnapshotSchema.parse(result)).toEqual(result);
    expect(result.current?.precipitation).toBe(0.3);
    expect(result.locationVersion).toBe(4);
  });
  it.each(['2026-03-29T00:30:00Z', '2026-10-24T23:30:00Z'])('keeps elapsed duration across DST or midnight (%s)', (start) => {
    const time = Date.parse(start);
    const raw = fixture(time - 1800_000);
    const response = normalize({ ...raw, current: { ...raw.current, time: time / 1000 } }, time);
    expect(Date.parse(response.period.end) - Date.parse(response.period.start)).toBe(10_800_000);
  });
  it('handles a fractional timezone hourly grid without flooring to UTC hours', () => {
    const time = Date.parse('2026-10-25T00:40:00Z');
    const location = { ...place, timezone: 'Asia/Kathmandu' };
    const raw = fixture(Date.parse('2026-10-25T00:15:00Z'));
    const result = normalizeForecast({ ...raw, timezone: location.timezone }, location, time, 'fresh', new Date(now).toISOString(), 1);
    expect(result.summary?.precipitationMm).toBe(3);
  });
  it.each([
    (raw: ReturnType<typeof fixture>) => ({ ...raw, hourly_units: { ...raw.hourly_units, wind_speed_10m: 'm/s' } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, current_units: { ...raw.current_units, temperature_2m: '°F' } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, timezone: 'America/New_York' }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, latitude: 20 }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, hourly: { ...raw.hourly, time: raw.hourly.time.map((v, i) => i === 2 ? v - 3600 : v) } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, hourly: { ...raw.hourly, time: raw.hourly.time.map((v, i) => i === 2 ? v + 100 : v) } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, hourly: { ...raw.hourly, precipitation: [null, ...raw.hourly.precipitation.slice(1)] } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, hourly: { ...raw.hourly, precipitation: [] } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, hourly: { ...raw.hourly, precipitation_probability: Array(8).fill(101) } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, current: { ...raw.current, time: now / 1000 + 3600 } }),
    (raw: ReturnType<typeof fixture>) => ({ ...raw, current: { ...raw.current, interval: 0 } }),
  ])('rejects mismatched or incomplete upstream data', (change) => {
    expect(() => normalize(change(fixture()))).toThrow();
  });
  it('estimates boundary instants rather than exposing extreme values outside the selected period', () => {
    const raw = fixture();
    const changed = { ...raw, current: { ...raw.current, temperature_2m: -90, apparent_temperature: -95, wind_speed_10m: 490, wind_gusts_10m: 490 },
      hourly: { ...raw.hourly, temperature_2m: [-50, 10, 10, 10, 90, 10, 10, 10], apparent_temperature: [-90, 5, 5, 5, 95, 5, 5, 5], wind_speed_10m: [100, 10, 10, 10, 200, 10, 10, 10] } };
    const result = normalize(changed);
    expect(result.summary).toMatchObject({ temperature: { min: -20, max: 50 }, apparentTemperature: { min: -42.5, max: 50 }, windSpeedMax: 105, windGustsMax: 24 });
    expect(result.current?.temperature).toBe(-90);
    expect(result.summary?.precipitationMm).toBe(3);
  });
  it('keeps exact-hour boundary instants and includes exactly three rainfall intervals', () => {
    const raw = fixture(now);
    const result = normalize(raw);
    expect(result.summary).toMatchObject({ temperature: { min: 10, max: 13 }, apparentTemperature: { min: 7, max: 10 }, windSpeedMax: 13, precipitationMm: 3,
      precipitationPeriod: { start: new Date(now).toISOString(), end: new Date(now + 10_800_000).toISOString() } });
  });
  it('requires coverage before now and beyond window end', () => {
    expect(() => normalize(fixture(now + 1800_000))).toThrow();
    expect(() => normalize(fixture(now - 1800_000, 3))).toThrow();
  });
  it('rejects aged current data as fresh but allows explicitly stale data', () => {
    expect(() => normalize(fixture(), now + 3600_000)).toThrow();
    expect(normalize(fixture(), now + 3600_000, 'stale').status).toBe('stale');
  });
  it('constructs a fixed provider request and shares cache for the same coordinates regardless of name', () => {
    const url = forecastUrl(place);
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('timezone')).toBe(place.timezone);
    expect(weatherCacheKey({ ...place, id: 'new', name: 'Other label' })).toBe(weatherCacheKey(place));
    expect(weatherCacheKey({ ...place, latitude: 52 })).not.toBe(weatherCacheKey(place));
  });
});

