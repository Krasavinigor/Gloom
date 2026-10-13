import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { resolveIntegrationDatabaseUrl } from '../config/test-database';

function main(): void {
  loadEnvConfig(process.cwd());
  const flag = process.argv[2];
  if (process.argv.length > 3 || !['--integration', '--coverage'].includes(flag)) {
    throw new Error('Use --integration or --coverage.');
  }
  const databaseUrl = resolveIntegrationDatabaseUrl(
    process.env.INTEGRATION_DATABASE_URL,
    process.env.DATABASE_URL,
  );
  if (flag === '--integration' && !databaseUrl) {
    throw new Error('Integration tests require INTEGRATION_DATABASE_URL or a local DATABASE_URL.');
  }
  const args = flag === '--integration' ? ['run', 'tests/integration'] : ['run', '--coverage'];
  const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), ...args], {
    stdio: 'inherit',
    env: { ...process.env, INTEGRATION_DATABASE_URL: databaseUrl },
  });
  child.once('error', () => {
    console.error('Unable to start the test runner. Install the project dependencies first.');
    process.exitCode = 1;
  });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
}

try {
  main();
} catch {
  console.error('Test setup failed. Check the command arguments and database configuration.');
  process.exitCode = 1;
}
