import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { resolveIntegrationDatabaseUrl } from '../config/test-database';
import { createDatabase } from '../db/connection';
import { migrateDatabase } from '../db/migrations';
import { weatherCacheKey } from '../weather/forecast';
import { makeForecast, testPlaces } from '../../../tests/fixtures/providers';

async function main() {
  loadEnvConfig(process.cwd());
  const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, process.env.DATABASE_URL);
  if (!url) throw new Error('Local PostgreSQL required.');
  const schema = `wardrobe_e2e_${randomUUID().replaceAll('-', '')}`;
  const administrator = createDatabase(url);
  const database = createDatabase(url, schema);
  const root = await mkdtemp(join(tmpdir(), 'wardrobe-e2e-'));
  try {
    await administrator.schema.createSchema(schema);
    await migrateDatabase(database, schema);
    const now = Date.now();
    const fetched = now - 16 * 60_000;
    const place = testPlaces.tallinn;
    await database('weather_cache').insert({ key: weatherCacheKey(place),
      payload: JSON.stringify(makeForecast(fetched, place.latitude, place.longitude, place.timezone)),
      fetched_at: new Date(fetched), expires_at: new Date(fetched + 15 * 60_000) });
    const code = await new Promise<number>((resolveCode, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test'], {
        stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DATABASE_SCHEMA: schema,
          E2E_MANAGED_SCHEMA: schema, FILE_STORAGE_ROOT: root, ENABLE_AI: 'false', OPENAI_API_KEY: '' },
      });
      child.once('error', reject);
      child.once('exit', exitCode => resolveCode(exitCode ?? 1));
      process.once('SIGINT', () => child.kill('SIGINT'));
      process.once('SIGTERM', () => child.kill('SIGTERM'));
    });
    process.exitCode = code;
  } finally {
    await database.destroy();
    await administrator.schema.dropSchemaIfExists(schema, true);
    await administrator.destroy();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error('Browser test setup failed. Check local PostgreSQL and run pnpm db:up first.');
  process.exitCode = 1;
});
