import type { Knex } from 'knex';
import { z } from 'zod';
import {
  recognitionProposalSchema,
  type RecognitionProposal,
} from '../../features/recognition/schema';
import type { InternalOperation } from '../operations/schema';
import { readPhotoFile } from '../storage/photo-files';

const payloadSchema = z.strictObject({
  draftId: z.uuid(),
  photoId: z.uuid(),
  outputLocale: z.enum(['en', 'ru']).default('ru'),
});

function currentDraft(database: Knex, operation: InternalOperation) {
  const payload = payloadSchema.safeParse(operation.payload);
  if (!payload.success || payload.data.draftId !== operation.targetId) return null;
  return database('garment_drafts as draft')
    .join('photo_assets as photo', 'photo.id', 'draft.photo_id')
    .where('draft.id', payload.data.draftId)
    .where('draft.photo_id', payload.data.photoId)
    .where('draft.recognition_operation_id', operation.id)
    .whereNull('draft.cancelled_at')
    .whereNull('draft.garment_id')
    .where('draft.expires_at', '>', database.fn.now())
    .where('photo.state', 'draft');
}

/** Checks reference validity without exposing a filesystem key to an HTTP response. */
export function createRecognitionContext(database: Knex, root: string, read = readPhotoFile) {
  async function load(operation: InternalOperation): Promise<Buffer | null> {
    const query = currentDraft(database, operation);
    const asset = query ? await query.select('photo.ai_key').first<{ ai_key: string }>() : null;
    return asset ? read(root, asset.ai_key) : null;
  }
  async function isCurrent(operation: InternalOperation): Promise<boolean> {
    const query = currentDraft(database, operation);
    return Boolean(query && (await query.select('draft.id').first()));
  }
  async function canDispatch(
    transaction: Knex.Transaction,
    operation: InternalOperation,
  ): Promise<boolean> {
    const query = currentDraft(transaction, operation);
    // The dispatch marker and this lock commit together. Save/cancel cannot slip between them.
    return Boolean(query && (await query.select('draft.id').forUpdate('draft').first()));
  }
  async function publish(
    transaction: Knex.Transaction,
    operation: InternalOperation,
    input: RecognitionProposal,
  ): Promise<boolean> {
    const payload = payloadSchema.safeParse(operation.payload);
    if (!payload.success || payload.data.draftId !== operation.targetId) return false;
    const proposal = recognitionProposalSchema.parse(input);
    // One conditional UPDATE serializes with save/cancel. Never change manual fields or a saved garment.
    const updated = await transaction('garment_drafts')
      .where({
        id: payload.data.draftId,
        photo_id: payload.data.photoId,
        recognition_operation_id: operation.id,
      })
      .whereNull('cancelled_at')
      .whereNull('garment_id')
      .where('expires_at', '>', transaction.fn.now())
      .whereExists(
        transaction('photo_assets')
          .select('id')
          .where({ id: payload.data.photoId, state: 'draft' }),
      )
      .update({ ai_proposal: { ...proposal, outputLocale: payload.data.outputLocale } });
    return updated === 1;
  }
  return { load, isCurrent, canDispatch, publish };
}
