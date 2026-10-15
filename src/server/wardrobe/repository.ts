import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Knex } from 'knex';
import { z } from 'zod';
import { recognitionProposalSchema } from '../../features/recognition/schema';
import {
  garmentFieldsSchema,
  WardrobeError,
  type Draft,
  type Garment,
  type GarmentFields,
  type PhotoAsset,
  type WardrobeSnapshot,
} from '../../features/wardrobe/schema';

interface AssetRow {
  id: string;
  key: string;
  ai_key: string;
  width: number;
  height: number;
  ai_width: number;
  ai_height: number;
  state: PhotoAsset['state'];
  expires_at: Date | null;
}
interface GarmentRow {
  id: string;
  photo_id: string | null;
  fields: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
interface DraftRow {
  id: string;
  photo_id: string | null;
  fields: unknown;
  expires_at: Date;
  garment_id: string | null;
  cancelled_at: Date | null;
  recognition_operation_id: string | null;
  ai_proposal: unknown;
}

const assetSchema = z
  .strictObject({
    id: z.uuid(),
    key: z.string(),
    aiKey: z.string(),
    width: z.number().int().min(1).max(2048),
    height: z.number().int().min(1).max(2048),
    aiWidth: z.number().int().min(1).max(1536),
    aiHeight: z.number().int().min(1).max(1536),
    state: z.literal('draft'),
    expiresAt: z.iso.datetime(),
  })
  .refine(
    (asset) => asset.key === `${asset.id}.jpg` && asset.aiKey === `${asset.id}.ai.jpg`,
    'Неверный ключ фотографии',
  );

const missing = () => new WardrobeError('NOT_FOUND', 404, 'Вещь или черновик не найдены.');
const expired = () =>
  new WardrobeError('DRAFT_EXPIRED', 410, 'Черновик недоступен. Загрузите фотографию снова.');
const conflict = () =>
  new WardrobeError(
    'VERSION_CONFLICT',
    409,
    'Данные уже изменились. Обновите гардероб и повторите действие.',
  );
const asAsset = (row: AssetRow): PhotoAsset => ({
  id: row.id,
  key: row.key,
  aiKey: row.ai_key,
  width: row.width,
  height: row.height,
  aiWidth: row.ai_width,
  aiHeight: row.ai_height,
  state: row.state,
  expiresAt: row.expires_at?.toISOString() ?? null,
});
const asGarment = (row: GarmentRow): Garment => {
  if (!row.photo_id || row.deleted_at) throw expired();
  return {
    id: row.id,
    photoId: row.photo_id,
    fields: garmentFieldsSchema.parse(row.fields),
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
};
const asDraft = (row: DraftRow): Draft => {
  if (!row.photo_id || row.cancelled_at || row.expires_at.getTime() <= Date.now()) throw expired();
  return {
    id: row.id,
    photoId: row.photo_id,
    fields: row.fields === null ? null : garmentFieldsSchema.parse(row.fields),
    expiresAt: row.expires_at.toISOString(),
    garmentId: row.garment_id,
    recognitionOperationId: row.recognition_operation_id,
    aiProposal: row.ai_proposal === null ? null : recognitionProposalSchema.parse(row.ai_proposal),
  };
};

export function createWardrobeRepository(database: Knex) {
  async function mutate<T>(work: (transaction: Knex.Transaction) => Promise<T>): Promise<T> {
    return database.transaction(async (transaction) => {
      const state = await transaction('app_state').where({ id: 'local' }).forUpdate().first();
      if (!state) throw new Error('Local wardrobe state is missing');
      return work(transaction);
    });
  }
  const increment = (transaction: Knex.Transaction) =>
    transaction('app_state').where({ id: 'local' }).increment('wardrobe_version', 1);

  async function list(): Promise<WardrobeSnapshot> {
    return database.transaction(
      async (transaction) => {
        const state = await transaction('app_state')
          .where({ id: 'local' })
          .first<{ wardrobe_version: number }>();
        if (!state) throw new Error('Local wardrobe state is missing');
        const garments = await transaction<GarmentRow>('garments')
          .whereNull('deleted_at')
          .orderBy('created_at', 'desc')
          .orderBy('id');
        const pending = await transaction('garments as garment')
          .join('photo_assets as photo', 'garment.photo_id', 'photo.id')
          .whereNotNull('garment.deleted_at')
          .where('photo.state', 'delete_pending')
          .select('garment.id');
        return {
          garments: garments.map(asGarment),
          wardrobeVersion: state.wardrobe_version,
          pendingDeletions: pending.map((row) => row.id),
        };
      },
      { isolationLevel: 'repeatable read', readOnly: true },
    );
  }

  async function createDraft(input: PhotoAsset): Promise<Draft> {
    const asset = assetSchema.parse(input);
    return mutate(async (transaction) => {
      await transaction('photo_assets').insert({
        id: asset.id,
        key: asset.key,
        ai_key: asset.aiKey,
        width: asset.width,
        height: asset.height,
        ai_width: asset.aiWidth,
        ai_height: asset.aiHeight,
        state: asset.state,
        expires_at: new Date(asset.expiresAt),
      });
      const [draft] = await transaction<DraftRow>('garment_drafts')
        .insert({ id: randomUUID(), photo_id: asset.id, expires_at: new Date(asset.expiresAt) })
        .returning('*');
      // An already-expired record can be inserted for recovery; it is never served.
      return {
        id: draft.id,
        photoId: asset.id,
        fields: null,
        expiresAt: draft.expires_at.toISOString(),
        garmentId: null,
        recognitionOperationId: null,
        aiProposal: null,
      };
    });
  }

  async function getDraft(id: string): Promise<Draft> {
    const row = await database<DraftRow>('garment_drafts').where({ id }).first();
    if (!row) throw missing();
    return asDraft(row);
  }

  async function saveDraft(id: string, input: GarmentFields): Promise<Garment> {
    const fields = garmentFieldsSchema.parse(input);
    return mutate(async (transaction) => {
      const draft = await transaction<DraftRow>('garment_drafts').where({ id }).forUpdate().first();
      if (!draft) throw missing();
      if (draft.garment_id) {
        const existing = await transaction<GarmentRow>('garments')
          .where({ id: draft.garment_id })
          .first();
        if (!existing || existing.deleted_at) throw expired();
        if (!isDeepStrictEqual(draft.fields, fields)) throw conflict();
        return asGarment(existing);
      }
      const active = asDraft(draft);
      const photo = await transaction<AssetRow>('photo_assets')
        .where({ id: active.photoId })
        .first();
      if (!photo || photo.state !== 'draft') throw expired();
      const [garment] = await transaction<GarmentRow>('garments')
        .insert({ id: randomUUID(), photo_id: active.photoId, fields })
        .returning('*');
      await transaction('photo_assets')
        .where({ id: active.photoId })
        .update({ state: 'attached', expires_at: null });
      await transaction('garment_drafts').where({ id }).update({ garment_id: garment.id, fields });
      await increment(transaction);
      return asGarment(garment);
    });
  }

  async function update(id: string, version: number, input: GarmentFields): Promise<Garment> {
    const fields = garmentFieldsSchema.parse(input);
    return mutate(async (transaction) => {
      const row = await transaction<GarmentRow>('garments')
        .where({ id })
        .whereNull('deleted_at')
        .forUpdate()
        .first();
      if (!row) throw missing();
      if (row.version !== version) throw conflict();
      const [updated] = await transaction<GarmentRow>('garments')
        .where({ id })
        .update({ fields, version: row.version + 1, updated_at: transaction.fn.now() })
        .returning('*');
      await increment(transaction);
      return asGarment(updated);
    });
  }

  async function deleteGarment(
    id: string,
    version: number,
  ): Promise<{ photo: PhotoAsset | null; alreadyDeleted: boolean }> {
    return mutate(async (transaction) => {
      const row = await transaction<GarmentRow>('garments').where({ id }).forUpdate().first();
      if (!row) throw missing();
      if (row.deleted_at) {
        const photo = row.photo_id
          ? await transaction<AssetRow>('photo_assets').where({ id: row.photo_id }).first()
          : undefined;
        return { photo: photo ? asAsset(photo) : null, alreadyDeleted: true };
      }
      if (row.version !== version) throw conflict();
      await transaction('garments')
        .where({ id })
        .update({
          deleted_at: transaction.fn.now(),
          updated_at: transaction.fn.now(),
          version: row.version + 1,
        });
      const [photo] = await transaction<AssetRow>('photo_assets')
        .where({ id: row.photo_id! })
        .update({ state: 'delete_pending', expires_at: null })
        .returning('*');
      await increment(transaction);
      return { photo: photo ? asAsset(photo) : null, alreadyDeleted: false };
    });
  }

  async function cancelDraft(id: string): Promise<void> {
    return mutate(async (transaction) => {
      const row = await transaction<DraftRow>('garment_drafts').where({ id }).forUpdate().first();
      if (!row) throw missing();
      if (row.garment_id) throw conflict();
      if (row.cancelled_at) return;
      await transaction('garment_drafts')
        .where({ id })
        .update({ cancelled_at: transaction.fn.now() });
      if (row.photo_id)
        await transaction('photo_assets')
          .where({ id: row.photo_id, state: 'draft' })
          .update({ state: 'delete_pending' });
    });
  }

  async function findAsset(id: string): Promise<PhotoAsset | null> {
    const row = await database<AssetRow>('photo_assets').where({ id }).first();
    return row ? asAsset(row) : null;
  }

  async function getAsset(id: string): Promise<PhotoAsset | null> {
    return database.transaction(
      async (transaction) => {
        const row = await transaction<AssetRow>('photo_assets').where({ id }).first();
        if (!row || row.state === 'delete_pending') return null;
        if (row.state === 'attached') {
          const garment = await transaction('garments')
            .where({ photo_id: id })
            .whereNull('deleted_at')
            .first();
          return garment ? asAsset(row) : null;
        }
        if (!row.expires_at || row.expires_at.getTime() <= Date.now()) return null;
        const draft = await transaction('garment_drafts')
          .where({ photo_id: id })
          .whereNull('cancelled_at')
          .whereNull('garment_id')
          .where('expires_at', '>', new Date())
          .first();
        return draft ? asAsset(row) : null;
      },
      { isolationLevel: 'repeatable read', readOnly: true },
    );
  }

  async function getDeletedAsset(id: string): Promise<PhotoAsset | null> {
    const garment = await database<GarmentRow>('garments').where({ id }).first();
    if (!garment) throw missing();
    if (!garment.deleted_at) throw conflict();
    return garment.photo_id ? findAsset(garment.photo_id) : null;
  }

  async function listDeletePending(): Promise<PhotoAsset[]> {
    const rows = await database<AssetRow>('photo_assets')
      .where({ state: 'delete_pending' })
      .orderBy('created_at');
    return rows.map(asAsset);
  }

  async function expireDrafts(now: Date): Promise<void> {
    return mutate(async (transaction) => {
      const drafts = await transaction<DraftRow>('garment_drafts')
        .whereNull('garment_id')
        .where('expires_at', '<=', now)
        .whereNotNull('photo_id')
        .forUpdate();
      if (!drafts.length) return;
      await transaction('photo_assets')
        .whereIn(
          'id',
          drafts.map((draft) => draft.photo_id!),
        )
        .where({ state: 'draft' })
        .update({ state: 'delete_pending' });
    });
  }

  async function completeCleanup(id: string): Promise<void> {
    return mutate(async (transaction) => {
      await transaction('photo_assets').where({ id, state: 'delete_pending' }).delete();
    });
  }

  async function assetReferencedKey(key: string): Promise<boolean> {
    const row = await database('photo_assets').where({ key }).orWhere({ ai_key: key }).first('id');
    return Boolean(row);
  }

  return {
    list,
    createDraft,
    getDraft,
    saveDraft,
    update,
    delete: deleteGarment,
    cancelDraft,
    getAsset,
    findAsset,
    getDeletedAsset,
    listDeletePending,
    expireDrafts,
    completeCleanup,
    assetReferencedKey,
  };
}

export type WardrobeRepository = ReturnType<typeof createWardrobeRepository>;
