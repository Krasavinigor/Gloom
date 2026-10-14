import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createLocationRepository } from '../../src/server/location/repository';
import { createGeocodingService } from '../../src/server/location/geocoding';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `location_test_${randomUUID().replaceAll('-', '')}`;
const place = {
  id: '524901', name: 'Москва', region: 'Москва', country: 'Россия', countryCode: 'RU',
  latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow',
};
const alternate = { ...place, id: '756135', name: 'Варшава', country: 'Польша', countryCode: 'PL', latitude: 52.23, longitude: 21.01, timezone: 'Europe/Warsaw' };

describe.skipIf(!url)('location PostgreSQL repository', () => {
  const admin = url ? createDatabase(url) : null;
  const db = url ? createDatabase(url, schema) : null;
  const repository = db ? createLocationRepository(db) : null;
  beforeAll(async () => {
    await admin!.schema.createSchema(schema);
    await migrateDatabase(db!, schema);
  });
  beforeEach(async () => {
    await db!('app_state').where({ id: 'local' }).update({ selected_place: null, location_source: null, location_version: 0 });
    await db!('geocoding_cache').delete();
  });
  afterAll(async () => {
    await db!.destroy();
    await admin!.schema.dropSchemaIfExists(schema, true);
    await admin!.destroy();
  });
  it('persists an approximate place, allows a manual replacement and rejects stale IP responses', async () => {
    expect(await repository!.get()).toEqual({ place: null, source: null, locationVersion: 0 });
    const approximate = await repository!.save(place, 'ip', 0);
    expect(approximate).toEqual({ place, source: 'ip', locationVersion: 1 });
    await expect(repository!.save(alternate, 'ip', 1)).rejects.toMatchObject({ status: 409 });
    const manual = await repository!.save(alternate, 'manual', 1);
    expect(manual).toEqual({ place: alternate, source: 'manual', locationVersion: 2 });
    await expect(repository!.save(place, 'ip', 0)).rejects.toMatchObject({ code: 'location_conflict', status: 409 });
    await expect(repository!.save(place, 'manual', 1)).rejects.toMatchObject({ status: 409 });
    expect(await repository!.save(alternate, 'manual', 2)).toEqual(manual);
    const reconnect = createDatabase(url!, schema);
    try {
      expect(await createLocationRepository(reconnect).get()).toEqual(manual);
    } finally {
      await reconnect.destroy();
    }
    expect((await db!('app_state').where({ id: 'local' }).first()).wardrobe_version).toBe(0);
  });
  it('serializes concurrent manual choices and preserves exactly one selection', async () => {
    await repository!.save(alternate, 'manual', 0);
    const results = await Promise.allSettled([
      repository!.save(place, 'manual', 1), repository!.save({ ...alternate, name: 'Warsaw' }, 'manual', 1),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await repository!.get()).locationVersion).toBe(2);
    await expect(repository!.save({ ...place, longitude: 300 }, 'manual', 2)).rejects.toThrow();
    await expect(repository!.save(place, 'manual', -1)).rejects.toThrow();
  });
  it('enforces source coherence and object-only JSON at the database boundary', async () => {
    await repository!.save(place, 'manual', 0);
    await expect(db!('app_state').where({ id: 'local' }).update({ selected_place: null })).rejects.toThrow();
    await expect(db!('app_state').where({ id: 'local' }).update({ selected_place: JSON.stringify([]) })).rejects.toThrow();
    await expect(db!('app_state').where({ id: 'local' }).update({ location_source: 'other' })).rejects.toThrow();
    await expect(db!('app_state').where({ id: 'local' }).update({ location_version: -1 })).rejects.toThrow();
    await expect(db!('geocoding_cache').insert({ cache_key: 'bad', payload: JSON.stringify([]), fetched_at: new Date(), expires_at: new Date() })).rejects.toThrow();
  });
  it('reuses persisted geocoding results across service instances and refreshes expiry', async () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ results: [{
      id: 524901, name: 'Москва', admin1: 'Москва', country: 'Россия', country_code: 'RU',
      latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow',
    }] }));
    const service = createGeocodingService(db!, { fetcher, clock: () => now });
    expect(await service.search('Москва')).toEqual([place]);
    const next = createGeocodingService(db!, { fetcher, clock: () => now + 1000 });
    expect(await next.search('МОСКВА')).toEqual([place]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const expired = createGeocodingService(db!, { fetcher, clock: () => now + 86_400_000 });
    expect(await expired.findCachedPlace('Москва', place.id)).toBeNull();
    expect(await expired.search('Москва')).toEqual([place]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
