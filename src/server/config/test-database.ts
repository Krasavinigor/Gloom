import { validateDatabaseUrl } from './environment';

function isLoopbackDatabaseUrl(value: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
}

export function resolveIntegrationDatabaseUrl(
  integrationDatabaseUrl: string | undefined,
  applicationDatabaseUrl: string | undefined,
): string | undefined {
  if (integrationDatabaseUrl) {
    const url = validateDatabaseUrl(integrationDatabaseUrl);
    if (!isLoopbackDatabaseUrl(url)) {
      throw new Error('INTEGRATION_DATABASE_URL must point to a loopback PostgreSQL server.');
    }
    return url;
  }
  if (!applicationDatabaseUrl) return undefined;
  const url = validateDatabaseUrl(applicationDatabaseUrl);
  return isLoopbackDatabaseUrl(url) ? url : undefined;
}
