import { makeForecast, testPlaces } from './providers.ts';
import { setTimeout as delay } from 'node:timers/promises';

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
  if (url.hostname === 'api.openai.com') {
    const method = options?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.pathname !== '/v1/responses' || method !== 'POST') {
      throw new Error('Unexpected OpenAI request in isolated browser tests.');
    }
    // A real worker, SDK, database ledger and SSE feed run around this deterministic transport.
    // The delay leaves enough time to reload the page while the durable task is running.
    await delay(3_000, undefined, { signal: options?.signal ?? (input instanceof Request ? input.signal : undefined) });
    const proposal = { kind: 'item', fields: {
      name: 'Зелёная футболка AI', type: 't_shirt', bodyAreas: ['torso'],
      seasons: ['summer'], layers: ['base'], color: 'зелёный', pattern: 'однотонная',
      warmth: 'light', temperature: { min: 18, max: 28 },
      rainProtection: 'unknown', windProtection: 'unknown',
    }, warnings: ['Температура комфорта указана приблизительно.'] };
    return Response.json({ id: 'resp_browser_fixture', status: 'completed', service_tier: 'default',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
      usage: { input_tokens: 100, output_tokens: 80,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
    }, { headers: { 'x-request-id': 'req_browser_fixture' } });
  }
  return originalFetch(input, options);
};
