import type { Knex } from 'knex';

export async function up(database: Knex): Promise<void> {
  await database.schema.createTable('app_settings', (table) => {
    table.text('id').primary();
    table.jsonb('preferences').notNullable().defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.check('?? = ?', ['id', 'local'], 'app_settings_local_only');
    table.check("jsonb_typeof(??) = 'object'", ['preferences'], 'app_settings_preferences_object');
  });
  await database('app_settings').insert({ id: 'local' });
}

export async function down(database: Knex): Promise<void> {
  await database.schema.dropTable('app_settings');
}
