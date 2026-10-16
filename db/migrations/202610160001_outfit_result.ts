import type { Knex } from 'knex';

export async function up(database: Knex): Promise<void> {
  await database.schema.createTable('outfit_result', (table) => {
    table.text('id').primary();
    table.integer('revision').notNullable().defaultTo(0);
    table
      .uuid('operation_id')
      .nullable()
      .references('id')
      .inTable('ai_operations')
      .onDelete('SET NULL');
    table
      .uuid('active_operation_id')
      .nullable()
      .references('id')
      .inTable('ai_operations')
      .onDelete('SET NULL');
    table.jsonb('result').nullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.check("?? = 'local'", ['id'], 'outfit_result_singleton');
    table.check('?? >= 0', ['revision'], 'outfit_result_revision');
    table.check(
      "?? IS NULL OR jsonb_typeof(??) = 'object'",
      ['result', 'result'],
      'outfit_result_object',
    );
  });
  await database('outfit_result').insert({ id: 'local' });
}

export async function down(database: Knex): Promise<void> {
  await database.schema.dropTable('outfit_result');
}
