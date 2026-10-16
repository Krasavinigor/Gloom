import { createHash } from 'node:crypto';
import type { Locale } from '../../i18n/core';
import type { Knex } from 'knex';
import { ApiError } from '../http/api-error';
import type { OperationsRepository } from '../operations/repository';
import { recognitionPricing, recognitionReserveMicroUsd } from './pricing';

export function createRecognitionService(options: {
  enabled: boolean;
  database: Knex;
  repository: OperationsRepository;
}) {
  const { database, repository } = options;
  async function start(draftId: string, idempotencyKey: string, outputLocale: Locale = 'en') {
    const existing = await database('ai_operations')
      .where({ idempotency_key: idempotencyKey })
      .first();
    if (existing) {
      if (existing.kind !== 'recognition' || existing.target_id !== draftId) {
        throw new ApiError(
          'OPERATION_CONFLICT',
          409,
          'Этот ключ уже использован для другого запроса.',
        );
      }
      return repository.get(existing.id);
    }
    if (!options.enabled)
      throw new ApiError(
        'AI_DISABLED',
        503,
        'Распознавание выключено. Можно заполнить карточку вручную.',
      );
    const draft = await database('garment_drafts').where({ id: draftId }).first();
    if (!draft?.photo_id) throw new ApiError('NOT_FOUND', 404, 'Фотография черновика недоступна.');
    const payload = { draftId, photoId: draft.photo_id as string, outputLocale };
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          draftId: payload.draftId,
          photoId: payload.photoId,
          model: recognitionPricing.model,
          pricingRevision: recognitionPricing.revision,
        }),
      )
      .digest('hex');
    return repository.admit(
      {
        kind: 'recognition',
        targetId: draftId,
        idempotencyKey,
        payloadHash,
        payload,
        model: recognitionPricing.model,
        pricingRevision: recognitionPricing.revision,
        reserveMicroUsd: recognitionReserveMicroUsd(),
      },
      {
        validate: async (transaction, operationId) => {
          const current = await transaction('garment_drafts')
            .where({ id: draftId })
            .forUpdate()
            .first();
          if (
            !current ||
            current.cancelled_at ||
            current.garment_id ||
            !current.photo_id ||
            current.photo_id !== payload.photoId ||
            new Date(current.expires_at).getTime() <= Date.now()
          ) {
            throw new ApiError('DRAFT_UNAVAILABLE', 409, 'Черновик уже сохранён или недоступен.');
          }
          const photo = await transaction('photo_assets')
            .where({ id: current.photo_id, state: 'draft' })
            .first();
          if (!photo)
            throw new ApiError('DRAFT_UNAVAILABLE', 409, 'Фотография черновика недоступна.');
          await transaction('garment_drafts')
            .where({ id: draftId })
            .update({ recognition_operation_id: operationId, ai_proposal: null });
        },
      },
    );
  }
  return { start };
}
export type RecognitionService = ReturnType<typeof createRecognitionService>;
