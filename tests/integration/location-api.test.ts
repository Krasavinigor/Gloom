import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { createLocationHandlers } from '../../src/server/http/location-handlers';
import { createGeocodingService } from '../../src/server/location/geocoding';
import { createLocationRepository } from '../../src/server/location/repository';
import { createLocationWeatherService } from '../../src/server/location/service';
import { createWeatherService } from '../../src/server/weather/service';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `location_api_${randomUUID().replaceAll('-', '')}`;
const origin = 'http://127.0.0.1:3000';
const baseline = Date.parse('2026-10-14T10:30:00Z');
const place = {
  id: '524901', name: 'Москва', region: 'Москва', country: 'Россия', countryCode: 'RU',
  latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow',
};
const providerPlace = {
  id: 524901, name: place.name, admin1: place.region, country: place.country,
  country_code: place.countryCode, latitude: place.latitude, longitude: place.longitude,
  timezone: place.timezone,
};

function request(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { host: '127.0.0.1:3000', ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function forecastFixture() {
  const values = Array<number>(12).fill(10);
  const units = {
    time: 'unixtime', temperature_2m: '°C', apparent_temperature: '°C', precipitation: 'mm',
    weather_code: 'wmo code', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h',
  };
  return {
    latitude: place.latitude, longitude: place.longitude, timezone: place.timezone,
    current_units: { ...units, interval: 'seconds', is_day: '' },
    hourly_units: { ...units, precipitation_probability: '%' },
    current: { time: baseline / 1000, interval: 900, temperature_2m: 10, apparent_temperature: 8,
      precipitation: 0, weather_code: 3, is_day: 1, wind_speed_10m: 10, wind_gusts_10m: 20 },
    hourly: { time: values.map((_, index) => baseline / 1000 - 1800 + index * 3600),
      temperature_2m: values, apparent_temperature: values, wind_speed_10m: values,
      wind_gusts_10m: values, precipitation: Array(12).fill(0), precipitation_probability: values,
      weather_code: Array(12).fill(3) },
  };
}

const manualSelection = (expectedVersion = 0) => ({ source: 'manual', query: 'Москва', placeId: place.id, expectedVersion, searchLocale: 'en' });
const ipSelection = (expectedVersion = 0) => ({ source: 'ip', candidate: { ...place, id: 'ip' }, expectedVersion });

describe.skipIf(!url)('location HTTP handlers with PostgreSQL and isolated provider fixtures', () => {
  const admin = url ? createDatabase(url) : null;
  const db = url ? createDatabase(url, schema) : null;
  const repository = db ? createLocationRepository(db) : null;
  let now = baseline;
  const geocodingFetch = vi.fn<typeof fetch>();
  const weatherFetch = vi.fn<typeof fetch>();
  const geocoding = db ? createGeocodingService(db, { fetcher: geocodingFetch, clock: () => now }) : null;
  const weather = db ? createWeatherService(db, { fetcher: weatherFetch, clock: () => now }) : null;
  const service = repository && geocoding && weather ? createLocationWeatherService(repository, geocoding, weather) : null;
  const handlers = createLocationHandlers(async () => service!);

  beforeAll(async () => {
    await admin!.schema.createSchema(schema);
    await migrateDatabase(db!, schema);
  });
  beforeEach(async () => {
    now = baseline;
    geocodingFetch.mockReset().mockImplementation(async () => Response.json({ results: [providerPlace] }));
    weatherFetch.mockReset().mockImplementation(async () => Response.json(forecastFixture()));
    await db!('app_state').where({ id: 'local' }).update({ selected_place: null, location_source: null, location_version: 0 });
    await db!('geocoding_cache').delete();
    await db!('weather_cache').delete();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db!.destroy();
    await admin!.schema.dropSchemaIfExists(schema, true);
    await admin!.destroy();
  });

  async function searchAndSelect() {
    const search = await handlers.search(request('/api/places?query=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0'));
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual({ success: true, data: [place] });
    const selected = await handlers.select(request('/api/location', manualSelection()));
    expect(selected.status).toBe(200);
    return selected.json();
  }

  it('starts empty without provider calls and persists a server-verified manual selection', async () => {
    const empty = { place: null, source: null, locationVersion: 0 };
    expect(await (await handlers.get(request('/api/location'))).json()).toEqual({ success: true, data: empty });
    expect(await service!.context()).toEqual({ location: empty, weather: null });
    expect(geocodingFetch).not.toHaveBeenCalled();
    expect(weatherFetch).not.toHaveBeenCalled();
    expect(await searchAndSelect()).toEqual({ success: true, data: { place, source: 'manual', locationVersion: 1 } });
    const reconnect = createDatabase(url!, schema);
    try {
      expect(await createLocationRepository(reconnect).get()).toEqual({ place, source: 'manual', locationVersion: 1 });
    } finally {
      await reconnect.destroy();
    }
    expect(weatherFetch).not.toHaveBeenCalled();
  });

  it('keeps language-specific search caches and accepts a captured search locale after switching', async () => {
    geocodingFetch.mockImplementation(async (input) => {
      const locale = new URL(String(input)).searchParams.get('language');
      return Response.json({ results: [{ ...providerPlace, name: locale === 'en' ? 'Moscow' : 'Москва' }] });
    });
    const english = await handlers.search(request('/api/places?query=Moscow&locale=en', undefined, { cookie: 'gloom-locale=ru' }));
    expect(await english.json()).toMatchObject({ data: [{ name: 'Moscow' }] });
    const russian = await handlers.search(request('/api/places?query=Moscow', undefined, { cookie: 'gloom-locale=ru' }));
    expect(await russian.json()).toMatchObject({ data: [{ name: 'Москва' }] });
    expect(geocodingFetch).toHaveBeenCalledTimes(2);
    const keys = await db!('geocoding_cache').select('cache_key').orderBy('cache_key');
    expect(keys.map(row => row.cache_key)).toEqual(['en:8:moscow', 'ru:8:moscow']);
    const chosen = await handlers.select(request('/api/location', { ...manualSelection(), query: 'Moscow' }, { cookie: 'gloom-locale=ru' }));
    expect(await chosen.json()).toMatchObject({ data: { place: { name: 'Moscow' }, locationVersion: 1 } });
    await handlers.search(request('/api/places?query=Moscow&locale=ru'));
    expect((await repository!.get()).locationVersion).toBe(1);
    expect(geocodingFetch).toHaveBeenCalledTimes(2);
    expect((await handlers.search(request('/api/places?query=Moscow&locale=de'))).status).toBe(400);
    expect(geocodingFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps legacy cached Russian selections valid when searchLocale is absent', async () => {
    await handlers.search(request('/api/places?query=Москва&locale=ru'));
    const legacy = { source: 'manual', query: 'Москва', placeId: place.id, expectedVersion: 0 };
    const response = await handlers.select(request('/api/location', legacy));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { place, locationVersion: 1 } });
    expect(geocodingFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects client-authored manual coordinates, raw IP fields and malformed candidate fields', async () => {
    await handlers.search(request('/api/places?query=Москва'));
    for (const input of [
      { ...manualSelection(), candidate: place }, { ...manualSelection(), latitude: 1, longitude: 2 },
      { ...ipSelection(), ip: '203.0.113.1' },
      { ...ipSelection(), candidate: { ...place, id: 'ip', ip: '203.0.113.1' } },
      { ...ipSelection(), candidate: { ...place, id: 'ip', latitude: 91 } },
      { ...ipSelection(), candidate: { ...place, id: 'ip', timezone: 'Unknown/timezone' } },
      { ...ipSelection(), source: 'unknown' }, { ...manualSelection(), expectedVersion: '0' },
      { ...manualSelection(), expectedVersion: -1 }, { ...manualSelection(), expectedVersion: undefined },
    ]) {
      const response = await handlers.select(request('/api/location', input));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ success: false, error: { code: 'invalid_location' } });
    }
    expect((await repository!.get()).place).toBeNull();
  });

  it('accepts an initial approximate candidate and protects later manual choices from delayed IP responses', async () => {
    const approximate = await handlers.select(request('/api/location', ipSelection()));
    expect(await approximate.json()).toMatchObject({ success: true, data: { source: 'ip', locationVersion: 1 } });
    await handlers.search(request('/api/places?query=Москва'));
    const manual = await handlers.select(request('/api/location', manualSelection(1)));
    expect(manual.status).toBe(200);
    for (const version of [0, 2]) {
      expect((await handlers.select(request('/api/location', ipSelection(version)))).status).toBe(409);
    }
    expect(await repository!.get()).toEqual({ place, source: 'manual', locationVersion: 2 });
  });

  it('requires a new search after cache expiry and rejects missing IDs or stale selection versions', async () => {
    await handlers.search(request('/api/places?query=Москва'));
    expect((await handlers.select(request('/api/location', { ...manualSelection(), placeId: 'missing' }))).status).toBe(409);
    now += 86_400_000;
    const expired = await handlers.select(request('/api/location', manualSelection()));
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ error: { code: 'search_expired' } });
    expect(geocodingFetch).toHaveBeenCalledTimes(1);
    await handlers.search(request('/api/places?query=Москва'));
    expect(geocodingFetch).toHaveBeenCalledTimes(2);
    expect((await handlers.select(request('/api/location', manualSelection(4)))).status).toBe(409);
    expect((await handlers.select(request('/api/location', manualSelection()))).status).toBe(200);
  });

  it('rejects foreign hosts/origins and malformed search/version input before provider work', async () => {
    expect((await handlers.get(request('/api/location', undefined, { host: 'attacker.example' }))).status).toBe(403);
    expect((await handlers.select(request('/api/location', ipSelection(), { origin: 'https://attacker.example' }))).status).toBe(403);
    for (const path of ['/api/places', '/api/places?query=x']) {
      expect((await handlers.search(request(path))).status).toBe(400);
    }
    for (const path of ['/api/weather', '/api/weather?locationVersion=bad', '/api/weather?locationVersion=-1', '/api/weather?locationVersion=9999999999']) {
      expect((await handlers.weather(request(path))).status).toBe(400);
    }
    expect((await handlers.weather(request('/api/weather?locationVersion=0'))).status).toBe(400);
    expect(geocodingFetch).not.toHaveBeenCalled();
    expect(weatherFetch).not.toHaveBeenCalled();
  });

  it('returns a safe 503 on failed search without inventing or saving a place', async () => {
    geocodingFetch.mockRejectedValue(new Error('secret upstream token'));
    const response = await handlers.search(request('/api/places?query=Москва'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, error: { code: 'geocoding_unavailable' } });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect((await repository!.get()).place).toBeNull();
    expect(await db!('geocoding_cache').count('* as count').first()).toEqual({ count: '0' });
  });

  it.each(['malformed', 'network'])('reports weather unavailable on %s failure without caching fake data', async (failure) => {
    await searchAndSelect();
    if (failure === 'malformed') weatherFetch.mockResolvedValue(Response.json({ invalid: true }));
    else weatherFetch.mockRejectedValue(new Error('secret provider response'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await handlers.weather(request('/api/weather?locationVersion=1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, data: { status: 'unavailable', locationVersion: 1, current: null, summary: null } });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(await db!('weather_cache').count('* as count').first()).toEqual({ count: '0' });
  });

  it('returns marked stale weather after refresh failure and preserves the last valid cached forecast', async () => {
    await searchAndSelect();
    const fresh = await handlers.weather(request('/api/weather?locationVersion=1'));
    expect(await fresh.json()).toMatchObject({ data: { status: 'fresh', locationVersion: 1 } });
    const saved = await db!('weather_cache').first();
    now += 3_600_000;
    weatherFetch.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stale = await handlers.weather(request('/api/weather?locationVersion=1'));
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ data: { status: 'stale', fetchedAt: new Date(baseline).toISOString() } });
    expect(await db!('weather_cache').first()).toEqual(saved);
  });

  it('rejects an in-flight forecast if the selected place changes before the provider responds', async () => {
    await searchAndSelect();
    let begin!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { begin = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    weatherFetch.mockImplementation(async () => { begin(); await waiting; return Response.json(forecastFixture()); });
    const pending = handlers.weather(request('/api/weather?locationVersion=1'));
    await started;
    await repository!.save({ ...place, id: 'new-place', name: 'Другое место' }, 'manual', 1);
    release();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'location_changed' } });
    expect((await repository!.get()).place?.id).toBe('new-place');
    expect((await handlers.weather(request('/api/weather?locationVersion=1'))).status).toBe(409);
  });
});
