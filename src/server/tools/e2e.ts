import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { resolveIntegrationDatabaseUrl } from '../config/test-database';
import { createDatabase } from '../db/connection';
import { migrateDatabase } from '../db/migrations';
import { weatherCacheKey } from '../weather/forecast';
import { makeForecast, testPlaces } from '../../../tests/fixtures/providers';

async function stopWorker(worker: ChildProcess | undefined) {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => worker.kill('SIGKILL'), 5_000);
    worker.once('exit', () => { clearTimeout(timer); done(); });
    worker.kill('SIGTERM');
  });
}

async function main() {
  loadEnvConfig(process.cwd());
  const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, process.env.DATABASE_URL);
  if (!url) throw new Error('Local PostgreSQL required.');
  const schema = `wardrobe_e2e_${randomUUID().replaceAll('-', '')}`;
  const administrator = createDatabase(url);
  const database = createDatabase(url, schema);
  const root = await mkdtemp(join(tmpdir(), 'wardrobe-e2e-'));
  let worker: ChildProcess | undefined;
  try {
    await administrator.schema.createSchema(schema);
    await migrateDatabase(database, schema);
    const now = Date.now();
    const fetched = now - 16 * 60_000;
    const place = testPlaces.tallinn;
    await database('weather_cache').insert({ key: weatherCacheKey(place),
      payload: JSON.stringify(makeForecast(fetched, place.latitude, place.longitude, place.timezone)),
      fetched_at: new Date(fetched), expires_at: new Date(fetched + 15 * 60_000) });
    const environment = { ...process.env, DATABASE_URL: url, DATABASE_SCHEMA: schema,
      E2E_MANAGED_SCHEMA: schema, FILE_STORAGE_ROOT: root, ENABLE_AI: 'true',
      OPENAI_API_KEY: 'sk-isolated-browser-test-fixture' };
    worker = spawn(process.execPath, ['--import', 'tsx', '--import',
      pathToFileURL(resolve('tests/fixtures/provider-preload.mjs')).href,
      resolve('src/worker/index.ts')], { stdio: 'inherit', env: environment });
    await new Promise<void>((ready, reject) => {
      worker!.once('spawn', ready);
      worker!.once('error', reject);
    });
    const code = await new Promise<number>((resolveCode, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)], {
        stdio: 'inherit', env: environment,
      });
      child.once('error', reject);
      child.once('exit', exitCode => resolveCode(exitCode ?? 1));
      process.once('SIGINT', () => child.kill('SIGINT'));
      process.once('SIGTERM', () => child.kill('SIGTERM'));
    });
    process.exitCode = code;
  } finally {
    await stopWorker(worker);
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
