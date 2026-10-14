import type { Knex } from 'knex';

export async function up(database: Knex): Promise<void> {
  await database.schema.alterTable('app_state', (table) => {
    table.jsonb('selected_place');
    table.text('location_source');
    table.integer('location_version').notNullable().defaultTo(0);
    table.check(
      "selected_place IS NULL OR jsonb_typeof(selected_place) = 'object'",
      [], 'app_state_place_object',
    );
    table.check(
      "location_source IS NULL OR location_source IN ('manual', 'ip')",
      [], 'app_state_location_source',
    );
    table.check(
      '(selected_place IS NULL) = (location_source IS NULL)',
      [], 'app_state_location_coherence',
    );
    table.check('location_version >= 0', [], 'app_state_location_version');
  });
  await database.schema.createTable('geocoding_cache', (table) => {
    table.text('cache_key').primary();
    table.jsonb('payload').notNullable();
    table.timestamp('fetched_at', { useTz: true }).notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable().index();
    table.check("jsonb_typeof(??) = 'object'", ['payload'], 'geocoding_cache_payload_object');
  });
}

export async function down(database: Knex): Promise<void> {
  await database.schema.dropTable('geocoding_cache');
  await database.schema.alterTable('app_state', (table) => {
    table.dropColumns('selected_place', 'location_source', 'location_version');
  });
}
