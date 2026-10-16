import { getBackgroundPreset, selectBackground } from '../../features/backgrounds/catalog';
import type { Locale } from '../../i18n/core';
import type { Knex } from 'knex';
import { z } from 'zod';
import { placeSchema, type Place } from '../../features/location/schema';
import type { ValidatedOutfit } from '../../features/outfits/schema';
import { validateOutfit, replacementAlternatives } from '../../features/outfits/validation';
import { garmentFieldsSchema, type Garment } from '../../features/wardrobe/schema';
import { weatherSnapshotSchema, type WeatherSnapshot } from '../../features/weather/schema';
import { ApiError } from '../http/api-error';
import type { InternalOperation } from '../operations/schema';
import { isWeatherContextCurrent, sameWeatherFacts } from './weather-context';

export const OUTFITS_TARGET_ID = '00000000-0000-4000-8000-000000000005';
const garmentSchema = z.object({
  id: z.uuid(),
  photoId: z.uuid(),
  fields: garmentFieldsSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const inputSnapshotSchema = z.object({
  wardrobeVersion: z.number().int().nonnegative(),
  locationVersion: z.number().int().nonnegative(),
  place: placeSchema,
  weather: weatherSnapshotSchema,
  garments: z.array(garmentSchema).max(1000),
});
const payloadSchema = z.strictObject({
  snapshot: inputSnapshotSchema,
  expectedRevision: z.number().int().nonnegative(),
  outputLocale: z.enum(['en', 'ru']).default('ru'),
});
export type OutfitInputSnapshot = {
  wardrobeVersion: number;
  locationVersion: number;
  place: Place;
  weather: WeatherSnapshot;
  garments: Garment[];
};
export type OutfitResult = {
  outputLocale?: Locale;
  outfits: ValidatedOutfit[];
  snapshot: OutfitInputSnapshot;
  backgroundPresetId: string;
  createdAt: string;
};
export type OutfitState = {
  result: OutfitResult | null;
  revision: number;
  activeOperationId: string | null;
  stale: boolean;
  staleReasons: string[];
  unavailableGarmentIds: string[];
};
type ResultRow = {
  id: string;
  revision: number;
  operation_id: string | null;
  active_operation_id: string | null;
  result: OutfitResult | null;
};
type StateRow = {
  id: string;
  wardrobe_version: number;
  location_version: number;
  selected_place: Place | null;
};
const composition = (items: ValidatedOutfit['items']) =>
  items
    .map((item) => item.garmentId)
    .sort()
    .join('|');
const uniqueReplacement = (
  result: OutfitResult,
  outfit: ValidatedOutfit,
  oldId: string,
  newId: string,
) => {
  const key = composition(
    outfit.items.map((item) => (item.garmentId === oldId ? { ...item, garmentId: newId } : item)),
  );
  return !result.outfits.some(
    (other) => other.id !== outfit.id && composition(other.items) === key,
  );
};
const conflict = () =>
  new ApiError('OUTFITS_STALE', 409, 'Исходные данные изменились. Запустите новый подбор.');
export function parseOutfitOperationPayload(payload: unknown) {
  return payloadSchema.parse(payload);
}

function asGarment(row: {
  id: string;
  photo_id: string;
  fields: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}): Garment {
  return {
    id: row.id,
    photoId: row.photo_id,
    fields: garmentFieldsSchema.parse(row.fields),
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
async function garments(database: Knex): Promise<Garment[]> {
  return (
    await database('garments as garment')
      .join('photo_assets as photo', 'photo.id', 'garment.photo_id')
      .whereNull('garment.deleted_at')
      .where('photo.state', 'attached')
      .select('garment.*')
      .orderBy('garment.created_at')
      .orderBy('garment.id')
  ).map(asGarment);
}
export function createOutfitsRepository(
  database: Knex,
  clock: () => Date = () => new Date(),
  options: { weatherCurrent?: typeof isWeatherContextCurrent } = {},
) {
  const weatherCurrent = options.weatherCurrent ?? isWeatherContextCurrent;
  async function capture() {
    return database.transaction(async (trx) => {
      const state = await trx<StateRow>('app_state').where({ id: 'local' }).forUpdate().first();
      const row = await trx<ResultRow>('outfit_result').where({ id: 'local' }).first();
      if (!state || !row) throw new Error('Outfit application state is missing');
      return {
        wardrobeVersion: state.wardrobe_version,
        locationVersion: state.location_version,
        place: state.selected_place,
        garments: await garments(trx),
        revision: row.revision,
        resultPeriodStart: row.result?.snapshot.weather.period.start ?? null,
      };
    });
  }
  async function read(weather?: WeatherSnapshot, now = clock()): Promise<OutfitState> {
    return database.transaction(async (trx) => {
      const state = await trx<StateRow>('app_state').where({ id: 'local' }).forUpdate().first();
      const row = (await trx<ResultRow>('outfit_result').where({ id: 'local' }).first())!;
      const active = row.active_operation_id
        ? await trx('ai_operations')
            .where({ id: row.active_operation_id })
            .whereIn('status', ['queued', 'running'])
            .first()
        : null;
      const current = await garments(trx);
      const result = row.result;
      const reasons = result
        ? [
            ...(state!.wardrobe_version !== result.snapshot.wardrobeVersion
              ? ['Гардероб изменился.']
              : []),
            ...(state!.location_version !== result.snapshot.locationVersion
              ? ['Выбрано другое место.']
              : []),
            ...(new Date(result.snapshot.weather.period.end) <= now
              ? ['Период подбора закончился.']
              : []),
            ...(weather && weather.status !== 'fresh' ? ['Свежая погода недоступна.'] : []),
            ...(weather &&
            weather.status === 'fresh' &&
            !sameWeatherFacts(weather, result.snapshot.weather)
              ? ['Погодные условия изменились.']
              : []),
          ]
        : [];
      const unavailableGarmentIds = result
        ? result.snapshot.garments
            .filter(
              (item) =>
                !current.some(
                  (activeItem) => activeItem.id === item.id && activeItem.photoId === item.photoId,
                ),
            )
            .map((item) => item.id)
        : [];
      return {
        result,
        revision: row.revision,
        activeOperationId: active?.id ?? null,
        stale: reasons.length > 0,
        staleReasons: reasons,
        unavailableGarmentIds,
      };
    });
  }
  async function validateAdmission(
    trx: Knex.Transaction,
    operationId: string,
    snapshot: OutfitInputSnapshot,
    expectedRevision: number,
  ) {
    const state = await trx<StateRow>('app_state').where({ id: 'local' }).forUpdate().first();
    const row = await trx<ResultRow>('outfit_result').where({ id: 'local' }).forUpdate().first();
    if (
      !state ||
      !row ||
      state.wardrobe_version !== snapshot.wardrobeVersion ||
      state.location_version !== snapshot.locationVersion ||
      row.revision !== expectedRevision ||
      !(await weatherCurrent(trx, snapshot, clock))
    )
      throw conflict();
    await trx('outfit_result').where({ id: 'local' }).update({ active_operation_id: operationId });
  }
  async function canDispatch(
    trx: Knex.Transaction,
    operation: InternalOperation,
  ): Promise<boolean> {
    const parsed = payloadSchema.safeParse(operation.payload);
    if (!parsed.success || operation.kind !== 'outfits' || operation.targetId !== OUTFITS_TARGET_ID)
      return false;
    const state = await trx<StateRow>('app_state').where({ id: 'local' }).forUpdate().first();
    const row = await trx<ResultRow>('outfit_result').where({ id: 'local' }).forUpdate().first();
    return Boolean(
      state &&
      row &&
      state.wardrobe_version === parsed.data.snapshot.wardrobeVersion &&
      state.location_version === parsed.data.snapshot.locationVersion &&
      row.active_operation_id === operation.id &&
      row.revision === parsed.data.expectedRevision &&
      new Date(parsed.data.snapshot.weather.period.end) > clock() &&
      (await weatherCurrent(trx, parsed.data.snapshot, clock)) &&
      Date.parse(operation.deadlineAt) > clock().getTime(),
    );
  }
  async function publish(
    trx: Knex.Transaction,
    operation: InternalOperation,
    input: { outfits: ValidatedOutfit[]; backgroundPresetId: string },
  ): Promise<boolean> {
    if (!(await canDispatch(trx, operation))) return false;
    const { snapshot, expectedRevision, outputLocale } = parseOutfitOperationPayload(
      operation.payload,
    );
    if (input.outfits.length < 1 || input.outfits.length > 3)
      throw new Error('Invalid outfit result count');
    if (
      new Set(input.outfits.map((outfit) => outfit.id)).size !== input.outfits.length ||
      new Set(input.outfits.map((outfit) => composition(outfit.items))).size !==
        input.outfits.length
    )
      throw new Error('Duplicate outfit result');
    const validated = input.outfits.map((outfit) =>
      validateOutfit(
        {
          id: outfit.id,
          title: outfit.title,
          explanation: outfit.explanation,
          items: outfit.items,
        },
        snapshot.garments,
        snapshot.weather,
      ),
    );
    if (validated.some((item) => !item.valid)) throw new Error('Invalid outfit publication');
    if (
      getBackgroundPreset(input.backgroundPresetId).id !== input.backgroundPresetId ||
      selectBackground(snapshot.weather) !== input.backgroundPresetId
    )
      throw new Error('Invalid outfit background preset');
    const result: OutfitResult = {
      outputLocale,
      outfits: validated.flatMap((item) => (item.valid ? [item.outfit] : [])),
      snapshot,
      backgroundPresetId: z.string().min(1).max(100).parse(input.backgroundPresetId),
      createdAt: clock().toISOString(),
    };
    await trx('outfit_result')
      .where({ id: 'local', revision: expectedRevision, active_operation_id: operation.id })
      .update({
        revision: expectedRevision + 1,
        operation_id: operation.id,
        active_operation_id: null,
        result,
        updated_at: clock(),
      });
    return true;
  }
  async function alternatives(
    outfitId: string,
    garmentId: string,
    weather: WeatherSnapshot,
    now = clock(),
  ) {
    const state = await read(weather, now);
    if (!state.result || state.stale) throw conflict();
    const outfit = state.result.outfits.find((item) => item.id === outfitId);
    if (!outfit || !outfit.items.some((item) => item.garmentId === garmentId))
      throw new ApiError('OUTFIT_NOT_FOUND', 404, 'Образ или вещь не найдены.');
    return {
      garments: replacementAlternatives(
        outfit,
        garmentId,
        state.result.snapshot.garments,
        state.result.snapshot.weather,
      ).filter((item) => uniqueReplacement(state.result!, outfit, garmentId, item.id)),
      revision: state.revision,
    };
  }
  async function replace(
    input: { outfitId: string; garmentId: string; replacementId: string; expectedRevision: number },
    weather: WeatherSnapshot,
    now = clock(),
    outputLocale: Locale = 'en',
  ) {
    z.object({
      outfitId: z.string().min(1).max(100),
      garmentId: z.uuid(),
      replacementId: z.uuid(),
      expectedRevision: z.number().int().nonnegative(),
    }).parse(input);
    await database.transaction(async (trx) => {
      const state = await trx<StateRow>('app_state').where({ id: 'local' }).forUpdate().first();
      const row = await trx<ResultRow>('outfit_result').where({ id: 'local' }).forUpdate().first();
      const result = row?.result;
      if (
        !result ||
        row.revision !== input.expectedRevision ||
        state!.wardrobe_version !== result.snapshot.wardrobeVersion ||
        state!.location_version !== result.snapshot.locationVersion ||
        new Date(result.snapshot.weather.period.end) <= now ||
        weather.status !== 'fresh' ||
        !sameWeatherFacts(weather, result.snapshot.weather) ||
        !(await weatherCurrent(trx, result.snapshot, clock))
      )
        throw conflict();
      const outfit = result.outfits.find((item) => item.id === input.outfitId);
      if (!outfit) throw new ApiError('OUTFIT_NOT_FOUND', 404, 'Образ не найден.');
      const available = replacementAlternatives(
        outfit,
        input.garmentId,
        result.snapshot.garments,
        result.snapshot.weather,
      );
      if (
        !available.some((item) => item.id === input.replacementId) ||
        !uniqueReplacement(result, outfit, input.garmentId, input.replacementId)
      )
        throw new ApiError('INVALID_REPLACEMENT', 409, 'Эта вещь не подходит для замены.');
      const next = {
        id: outfit.id,
        title: outfit.title,
        explanation:
          outputLocale === 'ru'
            ? 'Вещь заменена. Комплект повторно проверен по погоде и составу.'
            : 'The item was replaced. The outfit was checked again for weather and completeness.',
        items: outfit.items.map((item) =>
          item.garmentId === input.garmentId ? { ...item, garmentId: input.replacementId } : item,
        ),
      };
      const validated = validateOutfit(next, result.snapshot.garments, result.snapshot.weather);
      if (!validated.valid)
        throw new ApiError('INVALID_REPLACEMENT', 409, 'Комплект не прошёл проверку после замены.');
      await trx('outfit_result')
        .where({ id: 'local' })
        .update({
          revision: row.revision + 1,
          result: {
            ...result,
            outfits: result.outfits.map((item) =>
              item.id === input.outfitId
                ? { ...validated.outfit, explanationSource: 'replacement' }
                : item,
            ),
          },
          updated_at: now,
        });
    });
    return read(weather, now);
  }
  async function findIdempotencyKey(idempotencyKey: string) {
    return database('ai_operations')
      .where({ idempotency_key: z.uuid().parse(idempotencyKey) })
      .first<{ id: string; kind: string; target_id: string }>();
  }
  return {
    capture,
    read,
    validateAdmission,
    canDispatch,
    publish,
    alternatives,
    replace,
    findIdempotencyKey,
  };
}
export type OutfitsRepository = ReturnType<typeof createOutfitsRepository>;
