import { makeForecast, testPlaces } from './providers.ts';

// Loaded solely by Playwright's own Next server, never by the application configuration.
if (!/^wardrobe_e2e_[a-f0-9]{32}$/.test(process.env.E2E_MANAGED_SCHEMA ?? '')
  || process.env.DATABASE_SCHEMA !== process.env.E2E_MANAGED_SCHEMA) {
  throw new Error('Provider fixtures require an isolated browser-test database.');
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.hostname === 'geocoding-api.open-meteo.com') {
    const query = url.searchParams.get('name') ?? '';
    if (query === 'Ошибка') return new Response(null, { status: 503 });
    const place = Object.values(testPlaces).find((item) => item.name === query);
    return Response.json({ results: place ? [{ id: Number(place.id), name: place.name,
      admin1: place.region, country: place.country, country_code: place.countryCode,
      latitude: place.latitude, longitude: place.longitude, timezone: place.timezone }] : [] });
  }
  if (url.hostname === 'api.open-meteo.com') {
    const latitude = Number(url.searchParams.get('latitude'));
    if (latitude === testPlaces.tallinn.latitude) return new Response(null, { status: 503 });
    return Response.json(makeForecast(Date.now(), latitude,
      Number(url.searchParams.get('longitude')), url.searchParams.get('timezone') ?? 'UTC'));
  }
  return originalFetch(input, options);
};
