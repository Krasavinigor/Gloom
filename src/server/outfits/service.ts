import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Place } from '../../features/location/schema';
import { preflightWardrobe } from '../../features/outfits/validation';
import type { WeatherSnapshot } from '../../features/weather/schema';
import { ApiError } from '../http/api-error';
import type { OperationsRepository } from '../operations/repository';
import { OUTFITS_TARGET_ID, type OutfitInputSnapshot, type OutfitsRepository } from './repository';

type Weather = {
  get(place: Place, locationVersion: number, periodStart?: number): Promise<WeatherSnapshot>;
};
type Options = {
  enabled: boolean;
  repository: OutfitsRepository;
  operations: OperationsRepository;
  weather: Weather;
  pricing: { model: string; revision: string; reserveMicroUsd: number };
  clock?: () => Date;
};
export function createOutfitsService(options: Options) {
  const { repository, operations, weather, pricing } = options;
  const clock = options.clock ?? (() => new Date());
  async function currentWeather(periodStart?: number) {
    const captured = await repository.capture();
    return {
      captured,
      weather: captured.place
        ? await weather.get(
            captured.place,
            captured.locationVersion,
            periodStart ??
              (captured.resultPeriodStart
                ? new Date(captured.resultPeriodStart).getTime()
                : undefined),
          )
        : undefined,
    };
  }
  async function get() {
    const current = await currentWeather();
    return repository.read(current.weather, clock());
  }
  async function start(idempotencyKey: string) {
    z.uuid().parse(idempotencyKey);
    const existing = await repository.findIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.kind !== 'outfits' || existing.target_id !== OUTFITS_TARGET_ID)
        throw new ApiError(
          'OPERATION_CONFLICT',
          409,
          'Этот ключ уже использован для другого запроса.',
        );
      return operations.get(existing.id);
    }
    if (!options.enabled)
      throw new ApiError(
        'AI_DISABLED',
        503,
        'Подбор с AI выключен. Включите его в локальных настройках.',
      );
    const startedAt = clock();
    const { captured, weather: forecast } = await currentWeather(startedAt.getTime());
    if (!captured.place) throw new ApiError('LOCATION_REQUIRED', 409, 'Сначала выберите место.');
    if (!captured.garments.length)
      throw new ApiError('WARDROBE_EMPTY', 409, 'Добавьте вещи в гардероб.');
    if (
      !forecast ||
      forecast.status !== 'fresh' ||
      !forecast.current ||
      !forecast.summary ||
      forecast.locationVersion !== captured.locationVersion ||
      forecast.placeId !== captured.place.id
    )
      throw new ApiError(
        'WEATHER_UNAVAILABLE',
        409,
        'Для подбора нужна свежая погода. Обновите её и повторите.',
      );
    const preflight = preflightWardrobe(captured.garments, forecast);
    if (!preflight.complete)
      throw new ApiError(
        'INCOMPLETE_WARDROBE',
        409,
        `Для полного образа не хватает: ${preflight.missing.join(', ')}.`,
      );
    const snapshot: OutfitInputSnapshot = {
      wardrobeVersion: captured.wardrobeVersion,
      locationVersion: captured.locationVersion,
      place: captured.place,
      garments: captured.garments,
      weather: forecast,
    };
    // The POST command has no client snapshot. Its immutable server snapshot is kept in payload,
    // while repeated empty commands retain the same identity even when the clock changes.
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ kind: 'outfits', targetId: OUTFITS_TARGET_ID }))
      .digest('hex');
    return operations.admit(
      {
        kind: 'outfits',
        targetId: OUTFITS_TARGET_ID,
        idempotencyKey,
        payloadHash,
        payload: { snapshot, expectedRevision: captured.revision },
        model: pricing.model,
        pricingRevision: pricing.revision,
        reserveMicroUsd: pricing.reserveMicroUsd,
      },
      {
        now: startedAt,
        validate: (trx, operationId) =>
          repository.validateAdmission(trx, operationId, snapshot, captured.revision),
      },
    );
  }
  async function alternatives(outfitId: string, garmentId: string) {
    const current = await currentWeather();
    if (!current.weather) throw new ApiError('LOCATION_REQUIRED', 409, 'Сначала выберите место.');
    return repository.alternatives(outfitId, garmentId, current.weather, clock());
  }
  async function replace(input: {
    outfitId: string;
    garmentId: string;
    replacementId: string;
    expectedRevision: number;
  }) {
    const current = await currentWeather();
    if (!current.weather) throw new ApiError('LOCATION_REQUIRED', 409, 'Сначала выберите место.');
    return repository.replace(input, current.weather, clock());
  }
  return { get, start, alternatives, replace };
}
export type OutfitsService = ReturnType<typeof createOutfitsService>;
