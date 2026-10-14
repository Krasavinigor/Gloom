import type { Knex } from 'knex';
import { z } from 'zod';
import {
  locationSourceSchema, locationStateSchema, placeSchema,
  type LocationSource, type LocationState, type Place,
} from '../../features/location/schema';
import { ApiError } from '../http/api-error';

const stateRowSchema = z.object({
  selected_place: placeSchema.nullable(),
  location_source: locationSourceSchema.nullable(),
  location_version: z.number().int().nonnegative(),
});
function toState(raw: unknown): LocationState {
  const row = stateRowSchema.parse(raw);
  return locationStateSchema.parse({
    place: row.selected_place, source: row.location_source, locationVersion: row.location_version,
  });
}

export function createLocationRepository(db: Knex) {
  return {
    async get(): Promise<LocationState> {
      return toState(await db('app_state').where({ id: 'local' }).first());
    },
    async save(input: Place, source: LocationSource, expectedVersion: number): Promise<LocationState> {
      const place = placeSchema.parse(input);
      const validatedSource = locationSourceSchema.parse(source);
      z.number().int().nonnegative().parse(expectedVersion);
      return db.transaction(async (transaction) => {
        const current = toState(await transaction('app_state').where({ id: 'local' }).forUpdate().first());
        if (current.locationVersion !== expectedVersion || (validatedSource === 'ip' && current.place)) {
          throw new ApiError('location_conflict', 409, 'Место уже изменилось. Обновите страницу и повторите выбор.');
        }
        if (current.source === validatedSource && JSON.stringify(current.place) === JSON.stringify(place)) {
          return current;
        }
        const next: LocationState = {
          place, source: validatedSource, locationVersion: current.locationVersion + 1,
        };
        await transaction('app_state').where({ id: 'local' }).update({
          selected_place: next.place, location_source: next.source, location_version: next.locationVersion,
        });
        return next;
      });
    },
  };
}
