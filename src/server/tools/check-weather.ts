import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { resolveIntegrationDatabaseUrl } from '../config/test-database';
import { createDatabase } from '../db/connection';
import { migrateDatabase } from '../db/migrations';
import { createGeocodingService } from '../location/geocoding';
import { createWeatherService } from '../weather/service';

async function main() {
  loadEnvConfig(process.cwd());
  const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, process.env.DATABASE_URL);
  if (!url) throw new Error('Local PostgreSQL required.');
  const schema = `weather_check_${randomUUID().replaceAll('-', '')}`;
  const administrator = createDatabase(url);
  const database = createDatabase(url, schema);
  try {
    await administrator.schema.createSchema(schema);
    await migrateDatabase(database, schema);
    const geocoding = createGeocodingService(database);
    const weather = createWeatherService(database);
    for (const query of ['Москва', 'Berlin']) {
      const [place] = await geocoding.search(query);
      if (!place) throw new Error('Example city was not found.');
      const snapshot = await weather.get(place, 0);
      console.info('Live Open-Meteo check:', { city: place.name, timezone: place.timezone,
        status: snapshot.status, fetchedAt: snapshot.fetchedAt, period: snapshot.period,
        hourlyPeriod: snapshot.summary?.precipitationPeriod });
      if (snapshot.status !== 'fresh') throw new Error('Verified forecast is unavailable.');
    }
    // Check only HTTP/CORS availability. Never read or log the IP/location payload.
    const response = await fetch('https://ipapi.co/json/', {
      headers: { Origin: 'http://127.0.0.1:3000' }, redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
    console.info('IP provider availability:', {
      status: response.status, browserOrigin: response.headers.get('access-control-allow-origin'),
    });
    await response.body?.cancel();
  } finally {
    await database.destroy();
    await administrator.schema.dropSchemaIfExists(schema, true);
    await administrator.destroy();
  }
}

main().catch(() => {
  console.error('Live service check failed. Check local PostgreSQL, network and provider availability.');
  process.exitCode = 1;
});
