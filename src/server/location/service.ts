import { z } from 'zod';
import type { Locale } from '../../i18n/core';
import { placeSchema, searchQuerySchema } from '../../features/location/schema';
import { ApiError } from '../http/api-error';
import type { createWeatherService } from '../weather/service';
import type { createGeocodingService } from './geocoding';
import type { createLocationRepository } from './repository';

const version = z.number().int().nonnegative().max(2_147_483_647);
export const selectLocationSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('manual'), query: searchQuerySchema, placeId: z.string().min(1).max(100), expectedVersion: version, searchLocale: z.enum(['en', 'ru']).optional() }),
  z.strictObject({ source: z.literal('ip'), candidate: placeSchema.refine(place => place.id === 'ip'), expectedVersion: version }),
]);
export type LocationSelection = z.output<typeof selectLocationSchema>;

const conflict = () => new ApiError('location_changed', 409, 'Место уже изменилось. Загрузите актуальное место и повторите действие.');

export function createLocationWeatherService(
  repository: ReturnType<typeof createLocationRepository>,
  geocoding: ReturnType<typeof createGeocodingService>,
  weather: ReturnType<typeof createWeatherService>,
) {
  async function select(input: unknown) {
    const selection = selectLocationSchema.parse(input);
    const place = selection.source === 'ip' ? selection.candidate
      : await geocoding.findCachedPlace(selection.query, selection.placeId, selection.searchLocale ?? 'ru');
    if (!place) throw new ApiError('search_expired', 409, 'Результат поиска больше недоступен. Найдите город ещё раз.');
    return repository.save(place, selection.source, selection.expectedVersion);
  }

  async function forecast(expectedVersion: number) {
    const location = await repository.get();
    if (!location.place) throw new ApiError('place_required', 400, 'Сначала выберите город.');
    if (location.locationVersion !== expectedVersion) throw conflict();
    const result = await weather.get(location.place, location.locationVersion);
    if ((await repository.get()).locationVersion !== location.locationVersion) throw conflict();
    return result;
  }

  async function context() {
    const location = await repository.get();
    if (!location.place) return { location, weather: null };
    const snapshot = await weather.get(location.place, location.locationVersion);
    const latest = await repository.get();
    return latest.locationVersion === location.locationVersion
      ? { location, weather: snapshot } : { location: latest, weather: null };
  }

  return { get: () => repository.get(), search: (query: string, locale: Locale = 'en') => geocoding.search(query, locale), select, forecast, context };
}

export type LocationWeatherService = ReturnType<typeof createLocationWeatherService>;
