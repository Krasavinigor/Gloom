import type { Knex } from 'knex';

export async function up(database: Knex): Promise<void> {
  await database.schema.createTable('weather_cache', (table) => {
    table.text('key').primary();
    table.jsonb('payload').notNullable();
    table.timestamp('fetched_at', { useTz: true }).notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.check("?? ~ '^[a-f0-9]{64}$'", ['key'], 'weather_cache_key');
    table.check("jsonb_typeof(??) = 'object'", ['payload'], 'weather_cache_payload_object');
    table.check('?? > ??', ['expires_at', 'fetched_at'], 'weather_cache_positive_ttl');
  });
}

export async function down(database: Knex): Promise<void> {
  await database.schema.dropTable('weather_cache');
}
