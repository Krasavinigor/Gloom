import 'server-only';
import { parseServerEnvironment } from './environment';

export function getPublicCapabilities(): Readonly<{ aiEnabled: boolean; databaseConfigured: boolean }> {
  const configuration = parseServerEnvironment(process.env);
  return {
    aiEnabled: configuration.aiEnabled,
    databaseConfigured: Boolean(configuration.databaseUrl),
  };
}
