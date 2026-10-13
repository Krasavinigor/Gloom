import knex, { type Knex } from 'knex';
import { validateDatabaseUrl } from '../config/environment';

export function validateDatabaseSchema(schema: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema name.');
  return schema;
}

export function createDatabase(databaseUrl: string, schema = 'public'): Knex {
  return knex({
    client: 'pg',
    connection: { connectionString: validateDatabaseUrl(databaseUrl), connectionTimeoutMillis: 5_000 },
    searchPath: [validateDatabaseSchema(schema)],
    pool: { min: 0, max: 5 },
    acquireConnectionTimeout: 5_000,
    debug: false,
  });
}
