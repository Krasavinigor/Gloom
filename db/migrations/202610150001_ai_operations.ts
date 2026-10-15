import type { Knex } from 'knex';

export async function up(database: Knex): Promise<void> {
  await database.schema.createTable('ai_budget_months', (table) => {
    table.text('month').primary();
    table.bigInteger('limit_micro_usd').notNullable().defaultTo(10_000_000);
    table.bigInteger('confirmed_cost').notNullable().defaultTo(0);
    table.bigInteger('active_reserved').notNullable().defaultTo(0);
    table.bigInteger('unknown_reserved').notNullable().defaultTo(0);
    table.check("?? ~ '^\\d{4}-\\d{2}$'", ['month']);
    table.check('?? >= 0 AND ?? >= 0 AND ?? >= 0 AND ?? >= 0', ['limit_micro_usd', 'confirmed_cost', 'active_reserved', 'unknown_reserved']);
  });
  await database.schema.createTable('ai_operations', (table) => {
    table.uuid('id').primary();
    table.text('kind').notNullable();
    table.uuid('target_id').notNullable();
    table.uuid('idempotency_key').notNullable().unique();
    table.text('payload_hash').notNullable();
    table.jsonb('payload');
    table.jsonb('result');
    table.text('model').notNullable();
    table.text('pricing_revision').notNullable();
    table.text('admission_month').notNullable().references('month').inTable('ai_budget_months');
    table.text('status').notNullable().defaultTo('queued');
    table.integer('status_revision').notNullable().defaultTo(1);
    table.text('send_state').notNullable().defaultTo('not_sent');
    table.text('error_code');
    table.text('lease_owner');
    table.timestamp('lease_expires_at', { useTz: true });
    table.timestamp('dispatch_at', { useTz: true });
    table.timestamp('deadline_at', { useTz: true }).notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('request_id');
    table.text('response_id');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.check("?? IN ('recognition', 'outfits', 'chat')", ['kind']);
    table.check("?? IN ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'interrupted')", ['status']);
    table.check("?? IN ('not_sent', 'sent_unknown', 'response_received')", ['send_state']);
    table.check('?? > 0 AND ?? >= 0', ['status_revision', 'attempts']);
    table.check("?? ~ '^[a-f0-9]{64}$'", ['payload_hash']);
    table.index(['status', 'created_at']);
  });
  // A target cannot acquire a second charge while its previous operation is active.
  await database.raw("CREATE UNIQUE INDEX ai_operations_active_target ON ai_operations (kind, target_id) WHERE status IN ('queued', 'running')");
  await database.schema.createTable('ai_cost_ledger', (table) => {
    table.uuid('operation_id').primary().references('id').inTable('ai_operations');
    table.text('admission_month').notNullable().references('month').inTable('ai_budget_months');
    table.text('model').notNullable();
    table.text('pricing_revision').notNullable();
    table.bigInteger('reserve_micro_usd').notNullable();
    table.bigInteger('confirmed_micro_usd');
    table.text('settlement_state').notNullable().defaultTo('reserved');
    table.timestamp('settled_at', { useTz: true });
    table.jsonb('usage');
    table.text('reconciliation_reference');
    table.check('?? > 0 AND (?? IS NULL OR ?? >= 0)', ['reserve_micro_usd', 'confirmed_micro_usd', 'confirmed_micro_usd']);
    table.check("?? IN ('reserved', 'confirmed', 'unknown', 'released')", ['settlement_state']);
    table.check("(?? = 'confirmed') = (?? IS NOT NULL)", ['settlement_state', 'confirmed_micro_usd']);
  });
  await database.schema.alterTable('garment_drafts', (table) => {
    table.jsonb('ai_proposal');
    table.uuid('recognition_operation_id').references('id').inTable('ai_operations');
  });
}

export async function down(database: Knex): Promise<void> {
  await database.schema.alterTable('garment_drafts', (table) => {
    table.dropColumn('recognition_operation_id');
    table.dropColumn('ai_proposal');
  });
  await database.schema.dropTable('ai_cost_ledger');
  await database.schema.dropTable('ai_operations');
  await database.schema.dropTable('ai_budget_months');
}
