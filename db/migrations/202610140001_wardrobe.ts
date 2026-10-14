import type { Knex } from 'knex';

async function createState(database: Knex): Promise<void> {
  await database.schema.createTable('app_state', (table) => {
    table.text('id').primary();
    table.integer('wardrobe_version').notNullable().defaultTo(0);
    table.check('?? = ?', ['id', 'local'], 'app_state_local_only');
    table.check('?? >= 0', ['wardrobe_version'], 'app_state_nonnegative_version');
  });
  await database('app_state').insert({ id: 'local' });
}

async function createAssets(database: Knex): Promise<void> {
  await database.schema.createTable('photo_assets', (table) => {
    table.uuid('id').primary();
    table.text('key').notNullable().unique();
    table.text('ai_key').notNullable().unique();
    table.integer('width').notNullable();
    table.integer('height').notNullable();
    table.integer('ai_width').notNullable();
    table.integer('ai_height').notNullable();
    table.text('state').notNullable();
    table.timestamp('expires_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.check(
      "?? IN ('draft', 'attached', 'delete_pending')",
      ['state'],
      'photo_assets_valid_state',
    );
    table.check(
      "?? != 'draft' OR ?? IS NOT NULL",
      ['state', 'expires_at'],
      'photo_assets_draft_expiry',
    );
    table.check(
      '?? BETWEEN 1 AND 2048 AND ?? BETWEEN 1 AND 2048 AND ?? BETWEEN 1 AND 1536 AND ?? BETWEEN 1 AND 1536',
      ['width', 'height', 'ai_width', 'ai_height'],
      'photo_assets_valid_dimensions',
    );
    table.check(
      "?? = ??::text || '.jpg' AND ?? = ??::text || '.ai.jpg'",
      ['key', 'id', 'ai_key', 'id'],
      'photo_assets_managed_keys',
    );
  });
}

async function createGarments(database: Knex): Promise<void> {
  await database.schema.createTable('garments', (table) => {
    table.uuid('id').primary();
    table.uuid('photo_id').unique().references('id').inTable('photo_assets').onDelete('SET NULL');
    table.jsonb('fields').notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.timestamp('deleted_at', { useTz: true });
    table.check('?? > 0', ['version'], 'garments_positive_version');
    table.check("jsonb_typeof(??) = 'object'", ['fields'], 'garments_fields_object');
    table.check(
      '?? IS NOT NULL OR ?? IS NOT NULL',
      ['photo_id', 'deleted_at'],
      'garments_live_photo',
    );
  });
}

async function createDrafts(database: Knex): Promise<void> {
  await database.schema.createTable('garment_drafts', (table) => {
    table.uuid('id').primary();
    table.uuid('photo_id').unique().references('id').inTable('photo_assets').onDelete('SET NULL');
    table.jsonb('fields');
    table.uuid('garment_id').unique().references('id').inTable('garments');
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('cancelled_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    table.check(
      "?? IS NULL OR jsonb_typeof(??) = 'object'",
      ['fields', 'fields'],
      'garment_drafts_fields_object',
    );
  });
}

export async function up(database: Knex): Promise<void> {
  await createState(database);
  await createAssets(database);
  await createGarments(database);
  await createDrafts(database);
}

export async function down(database: Knex): Promise<void> {
  await database.schema.dropTable('garment_drafts');
  await database.schema.dropTable('garments');
  await database.schema.dropTable('photo_assets');
  await database.schema.dropTable('app_state');
}
