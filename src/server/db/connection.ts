import knex, { type Knex } from 'knex';
import { validateDatabaseUrl } from '../config/environment';

export function validateDatabaseSchema(schema: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema name.');
  return schema;
}

export function createDatabase(databaseUrl: string, schema = 'public'): Knex {
  return knex({
    client: 'pg',
    connection: {
      connectionString: validateDatabaseUrl(databaseUrl), connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000, query_timeout: 20_000,
      idle_in_transaction_session_timeout: 15_000,
      options: '-c lock_timeout=5000',
    },
    searchPath: [validateDatabaseSchema(schema)],
    pool: { min: 0, max: 5 },
    acquireConnectionTimeout: 5_000,
    debug: false,
  });
}
