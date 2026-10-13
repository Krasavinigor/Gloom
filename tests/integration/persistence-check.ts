import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { getLocalSettings } from '../../src/server/db/settings';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';

function projectDatabaseUrl(): string {
  loadEnvConfig(process.cwd());
  const value = resolveIntegrationDatabaseUrl(undefined, process.env.DATABASE_URL);
  if (!value) throw new Error('A local DATABASE_URL is required.');
  const url = new URL(value);
  if ((url.port || '5432') !== (process.env.POSTGRES_PORT || '55432')
    || decodeURIComponent(url.pathname.slice(1)) !== (process.env.POSTGRES_DB || 'wardrobe')
    || decodeURIComponent(url.username) !== (process.env.POSTGRES_USER || 'wardrobe')) {
    throw new Error('Persistence checks require the Compose project database.');
  }
  return value;
}

async function checkPersistence(): Promise<void> {
  const url = projectDatabaseUrl();
  const schema = `wardrobe_persistence_${randomUUID().replaceAll('-', '')}`;
  const initial = createDatabase(url, schema);
  const admin = createDatabase(url);
  let created = false;
  try {
    await admin.schema.createSchema(schema);
    created = true;
    await migrateDatabase(initial, schema);
    await initial('app_settings').where({ id: 'local' }).update({ preferences: { probe: schema } });
    await initial.destroy();
    await admin.destroy();
    const restarted = spawnSync('docker', [
      'compose', '--env-file', '.env.local', 'up', '-d', '--force-recreate', '--wait', 'postgres',
    ], { stdio: 'inherit', timeout: 120_000 });
    if (restarted.error || restarted.status !== 0) throw new Error('Project PostgreSQL recreation failed.');
    const reconnected = createDatabase(url, schema);
    try {
      assert.deepEqual((await getLocalSettings(reconnected))?.preferences, { probe: schema });
      console.info('Persistence verified after recreating the PostgreSQL container with its existing volume.');
    } finally {
      await reconnected.destroy();
    }
  } finally {
    await initial.destroy();
    await admin.destroy();
    if (created) {
      const cleanup = createDatabase(url);
      try { await cleanup.schema.dropSchemaIfExists(schema, true); }
      finally { await cleanup.destroy(); }
    }
  }
}

checkPersistence().catch(() => {
  console.error('Persistence check failed. Check the local project database and Docker availability.');
  process.exitCode = 1;
});
