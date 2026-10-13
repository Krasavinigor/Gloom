import type { Knex } from 'knex';
import { z } from 'zod';

const localSettingsSchema = z.object({
  id: z.literal('local'),
  preferences: z.record(z.string(), z.unknown()),
  created_at: z.date(),
});

export type LocalSettings = z.infer<typeof localSettingsSchema>;

export async function getLocalSettings(database: Knex): Promise<LocalSettings | undefined> {
  const row: unknown = await database<LocalSettings>('app_settings')
    .select('id', 'preferences', 'created_at').where({ id: 'local' }).first();
  if (row === undefined) return undefined;
  const result = localSettingsSchema.safeParse(row);
  if (!result.success) throw new Error('Stored local settings do not match the expected schema.');
  return result.data;
}
