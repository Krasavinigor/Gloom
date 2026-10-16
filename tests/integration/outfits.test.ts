import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { garmentFieldsSchema } from '../../src/features/wardrobe/schema';
import { createDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrations';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';
import { createOutfitsRepository } from '../../src/server/outfits/repository';
import { createOperationsRepository } from '../../src/server/operations/repository';
import { createOutfitsService } from '../../src/server/outfits/service';
import type { WeatherSnapshot } from '../../src/features/weather/schema';

const url = resolveIntegrationDatabaseUrl(process.env.INTEGRATION_DATABASE_URL, undefined);
const schema = `outfits_test_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-10-16T12:00:00.000Z');
const place = {
  id: '1',
  name: 'Москва',
  region: '',
  country: 'Россия',
  countryCode: 'RU',
  latitude: 55.75,
  longitude: 37.6,
  timezone: 'Europe/Moscow',
};
const weather: WeatherSnapshot = {
  status: 'fresh',
  locationVersion: 1,
  placeId: '1',
  fetchedAt: now.toISOString(),
  period: {
    start: now.toISOString(),
    end: new Date(now.getTime() + 10800000).toISOString(),
    timezone: place.timezone,
  },
  current: {
    time: now.toISOString(),
    intervalSeconds: 900,
    temperature: 22,
    apparentTemperature: 22,
    weatherCode: 0,
    isDay: true,
    windSpeed: 1,
    windGusts: 2,
    precipitation: 0,
  },
  summary: {
    temperature: { min: 22, max: 23 },
    apparentTemperature: { min: 22, max: 23 },
    windSpeedMax: 1,
    windGustsMax: 2,
    precipitationMm: 0,
    precipitationProbabilityMax: 0,
    precipitationPeriod: {
      start: now.toISOString(),
      end: new Date(now.getTime() + 10800000).toISOString(),
    },
  },
  message: null,
};

describe.skipIf(!url)('outfit durable snapshot and optimistic publication', () => {
  const admin = url ? createDatabase(url) : null;
  const db = url ? createDatabase(url, schema) : null;
  const repository = db
    ? createOutfitsRepository(db, () => now, { weatherCurrent: async () => true })
    : null;
  const operations = db ? createOperationsRepository(db) : null;
  const service = () =>
    createOutfitsService({
      enabled: true,
      repository: repository!,
      operations: operations!,
      weather: { get: async () => weather },
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
      clock: () => now,
    });
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  beforeAll(async () => {
    await admin!.schema.createSchema(schema);
    await migrateDatabase(db!, schema);
    await db!('app_state').where({ id: 'local' }).update({
      selected_place: place,
      location_source: 'manual',
      location_version: 1,
      wardrobe_version: 1,
    });
    for (const [index, type] of ['t_shirt', 'trousers', 'sneakers', 't_shirt'].entries()) {
      const photo = randomUUID();
      await db!('photo_assets').insert({
        id: photo,
        key: `${photo}.jpg`,
        ai_key: `${photo}.ai.jpg`,
        width: 100,
        height: 100,
        ai_width: 100,
        ai_height: 100,
        state: 'attached',
      });
      await db!('garments').insert({
        id: ids[index],
        photo_id: photo,
        fields: garmentFieldsSchema.parse({
          name: `Вещь ${index}`,
          type,
          bodyAreas: [index === 1 ? 'legs' : index === 2 ? 'feet' : 'torso'],
          seasons: ['summer'],
          layers: index === 2 ? [] : ['base'],
        }),
      });
    }
  });
  beforeEach(async () => {
    await db!('outfit_result')
      .where({ id: 'local' })
      .update({ result: null, revision: 0, active_operation_id: null, operation_id: null });
    await db!('ai_cost_ledger').del();
    await db!('ai_operations').del();
    await db!('ai_budget_months').del();
    await db!('garments').update({ deleted_at: null });
    await db!('app_state').where({ id: 'local' }).update({
      wardrobe_version: 1,
      location_version: 1,
      selected_place: place,
      location_source: 'manual',
    });
  });
  afterAll(async () => {
    await db!.destroy();
    await admin!.schema.dropSchemaIfExists(schema, true);
    await admin!.destroy();
  });
  const outfits = () => [
    {
      id: 'summer',
      title: 'Летний образ',
      explanation: 'Лёгкие вещи.',
      items: [
        { garmentId: ids[0], role: 'base_top' as const },
        { garmentId: ids[1], role: 'bottom' as const },
        { garmentId: ids[2], role: 'footwear' as const },
      ],
      warnings: [],
      conditional: false,
    },
  ];
  async function publishedResult() {
    const operation = await service().start(randomUUID());
    const internal = await operations!.getInternal(operation.id);
    await db!.transaction((trx) =>
      repository!.publish(trx, internal, { outfits: outfits(), backgroundPresetId: 'clear-day' }),
    );
    return internal;
  }
  it('restores no result without any operation or AI charge', async () => {
    expect(await service().get()).toMatchObject({
      result: null,
      revision: 0,
      activeOperationId: null,
    });
    expect(await db!('ai_operations')).toHaveLength(0);
  });
  it('deduplicates admission and atomically publishes only the current snapshot', async () => {
    const key = randomUUID();
    const admitted = await service().start(key);
    expect((await service().start(key)).id).toBe(admitted.id);
    expect((await service().start(randomUUID())).id).toBe(admitted.id);
    const operation = await operations!.getInternal(admitted.id);
    const published = await db!.transaction((trx) =>
      repository!.publish(trx, operation, { outfits: outfits(), backgroundPresetId: 'clear-day' }),
    );
    expect(published).toBe(true);
    expect(await service().get()).toMatchObject({
      revision: 1,
      stale: false,
      result: { backgroundPresetId: 'clear-day' },
    });
    await db!('app_state').where({ id: 'local' }).increment('wardrobe_version', 1);
    expect(
      await db!.transaction((trx) =>
        repository!.publish(trx, operation, { outfits: [], backgroundPresetId: 'rain' }),
      ),
    ).toBe(false);
    expect(await service().get()).toMatchObject({ revision: 1, stale: true });
  });
  it('deduplicates concurrent command keys and restores the original even after its context changes', async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([service().start(key), service().start(key)]);
    expect(first.id).toBe(second.id);
    await operations!.finish(first.id, { status: 'failed' });
    await db!('app_state').where({ id: 'local' }).increment('wardrobe_version', 1);
    expect((await service().start(key)).id).toBe(first.id);
    expect(await db!('ai_operations')).toHaveLength(1);
  });
  it('rejects missing place, stale weather, disabled AI and incomplete wardrobe before reservation', async () => {
    const disabled = createOutfitsService({
      enabled: false,
      repository: repository!,
      operations: operations!,
      weather: { get: async () => weather },
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
    });
    await expect(disabled.start(randomUUID())).rejects.toMatchObject({ code: 'AI_DISABLED' });
    await db!('app_state')
      .where({ id: 'local' })
      .update({ selected_place: null, location_source: null });
    await expect(service().start(randomUUID())).rejects.toMatchObject({
      code: 'LOCATION_REQUIRED',
    });
    await db!('app_state')
      .where({ id: 'local' })
      .update({ selected_place: place, location_source: 'manual' });
    const stale = createOutfitsService({
      enabled: true,
      repository: repository!,
      operations: operations!,
      weather: { get: async () => ({ ...weather, status: 'stale' }) },
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
    });
    await expect(stale.start(randomUUID())).rejects.toMatchObject({ code: 'WEATHER_UNAVAILABLE' });
    await db!('garments').where({ id: ids[2] }).update({ deleted_at: now });
    await expect(service().start(randomUUID())).rejects.toMatchObject({
      code: 'INCOMPLETE_WARDROBE',
    });
    expect(await db!('ai_operations')).toHaveLength(0);
    await db!('garments').update({ deleted_at: now });
    await expect(service().start(randomUUID())).rejects.toMatchObject({ code: 'WARDROBE_EMPTY' });
  });
  it('performs a free role-compatible replacement, preserves other items and refuses old revisions', async () => {
    const operation = await publishedResult();
    const alternatives = await service().alternatives('summer', ids[0]);
    expect(alternatives.garments.map((item) => item.id)).toEqual([ids[3]]);
    const beforeBudget = await operations!.budget('2026-10');
    const replaced = await service().replace({
      outfitId: 'summer',
      garmentId: ids[0],
      replacementId: ids[3],
      expectedRevision: 1,
    });
    expect(replaced.revision).toBe(2);
    expect(replaced.result!.outfits[0].items).toEqual([
      { garmentId: ids[3], role: 'base_top' },
      { garmentId: ids[1], role: 'bottom' },
      { garmentId: ids[2], role: 'footwear' },
    ]);
    expect(await operations!.budget('2026-10')).toEqual(beforeBudget);
    expect(
      await db!.transaction((trx) =>
        repository!.publish(trx, operation, { outfits: outfits(), backgroundPresetId: 'rain' }),
      ),
    ).toBe(false);
    await expect(
      service().replace({
        outfitId: 'summer',
        garmentId: ids[3],
        replacementId: ids[0],
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'OUTFITS_STALE' });
    await expect(
      service().replace({
        outfitId: 'summer',
        garmentId: ids[3],
        replacementId: ids[1],
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REPLACEMENT' });
  });
  it('keeps the previous result on a failed run and marks removed photos unavailable', async () => {
    const operation = await publishedResult();
    await operations!.finish(operation.id, { status: 'failed' });
    const next = await service().start(randomUUID());
    await operations!.finish(next.id, { status: 'failed' });
    expect(await service().get()).toMatchObject({
      revision: 1,
      result: { backgroundPresetId: 'clear-day' },
    });
    await db!('garments').where({ id: ids[0] }).update({ deleted_at: now });
    await db!('app_state').where({ id: 'local' }).increment('wardrobe_version', 1);
    const state = await service().get();
    expect(state.unavailableGarmentIds).toEqual([ids[0]]);
    expect(state.stale).toBe(true);
    await expect(service().alternatives('summer', ids[0])).rejects.toMatchObject({
      code: 'OUTFITS_STALE',
    });
  });
  it('compares weather facts for the persisted period, ignoring fresh fetch timestamps', async () => {
    await publishedResult();
    const periodStarts: (number | undefined)[] = [];
    let changed = false;
    const refreshing = createOutfitsService({
      enabled: true,
      repository: repository!,
      operations: operations!,
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
      clock: () => new Date(now.getTime() + 60000),
      weather: {
        get: async (_place, _version, periodStart) => {
          periodStarts.push(periodStart);
          return {
            ...weather,
            fetchedAt: new Date(now.getTime() + 60000).toISOString(),
            current: { ...weather.current!, temperature: changed ? 10 : 22 },
          };
        },
      },
    });
    expect((await refreshing.get()).stale).toBe(false);
    expect(periodStarts).toEqual([now.getTime()]);
    changed = true;
    expect((await refreshing.get()).staleReasons).toContain('Погодные условия изменились.');
    expect(
      (await repository!.read(weather, new Date(now.getTime() + 10800001))).staleReasons,
    ).toContain('Период подбора закончился.');
    await db!('app_state').where({ id: 'local' }).increment('location_version', 1);
    expect((await repository!.read(weather, now)).staleReasons).toContain('Выбрано другое место.');
  });
  it('rolls back operation and reservation when the wardrobe changes during weather retrieval', async () => {
    const racing = createOutfitsService({
      enabled: true,
      repository: repository!,
      operations: operations!,
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
      clock: () => now,
      weather: {
        get: async () => {
          await db!('app_state').where({ id: 'local' }).increment('wardrobe_version', 1);
          return weather;
        },
      },
    });
    await expect(racing.start(randomUUID())).rejects.toMatchObject({ code: 'OUTFITS_STALE' });
    expect(await db!('ai_operations')).toHaveLength(0);
    expect(await db!('ai_cost_ledger')).toHaveLength(0);
    expect(await db!('ai_budget_months')).toHaveLength(0);
  });
  it('rejects malformed, duplicate and unrelated background publications without replacing a result', async () => {
    const admitted = await service().start(randomUUID());
    const operation = await operations!.getInternal(admitted.id);
    for (const input of [
      { outfits: [], backgroundPresetId: 'clear-day' },
      { outfits: [...outfits(), ...outfits()], backgroundPresetId: 'clear-day' },
      { outfits: outfits(), backgroundPresetId: 'unknown' },
      { outfits: outfits(), backgroundPresetId: 'rain' },
      {
        outfits: [
          {
            ...outfits()[0],
            items: [
              { garmentId: ids[0], role: 'base_top' as const },
              { garmentId: ids[1], role: 'bottom' as const },
            ],
          },
        ],
        backgroundPresetId: 'clear-day',
      },
    ])
      await expect(
        db!.transaction((trx) => repository!.publish(trx, operation, input)),
      ).rejects.toThrow();
    expect((await service().get()).result).toBeNull();
    await db!('app_state').where({ id: 'local' }).increment('location_version', 1);
    expect(await db!.transaction((trx) => repository!.canDispatch(trx, operation))).toBe(false);
  });
  it('does not offer or perform a replacement that duplicates another complete outfit', async () => {
    const admitted = await service().start(randomUUID());
    const operation = await operations!.getInternal(admitted.id);
    const first = outfits()[0];
    const second = {
      ...first,
      id: 'second',
      items: first.items.map((item) =>
        item.garmentId === ids[0] ? { ...item, garmentId: ids[3] } : item,
      ),
    };
    expect(
      await db!.transaction((trx) =>
        repository!.publish(trx, operation, {
          outfits: [first, second],
          backgroundPresetId: 'clear-day',
        }),
      ),
    ).toBe(true);
    expect((await service().alternatives('summer', ids[0])).garments).toEqual([]);
    await expect(
      service().replace({
        outfitId: 'summer',
        garmentId: ids[0],
        replacementId: ids[3],
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REPLACEMENT' });
    expect((await service().get()).revision).toBe(1);
  });
  it('checks the transaction weather guard before admission, dispatch, publication and replacement', async () => {
    let current = false;
    const guardedRepository = createOutfitsRepository(db!, () => now, {
      weatherCurrent: async () => current,
    });
    const guarded = createOutfitsService({
      enabled: true,
      repository: guardedRepository,
      operations: operations!,
      weather: { get: async () => weather },
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
      clock: () => now,
    });
    await expect(guarded.start(randomUUID())).rejects.toMatchObject({ code: 'OUTFITS_STALE' });
    expect(await db!('ai_operations')).toHaveLength(0);
    current = true;
    const admitted = await guarded.start(randomUUID());
    const operation = await operations!.getInternal(admitted.id);
    current = false;
    expect(await db!.transaction((trx) => guardedRepository.canDispatch(trx, operation))).toBe(
      false,
    );
    expect(
      await db!.transaction((trx) =>
        guardedRepository.publish(trx, operation, {
          outfits: outfits(),
          backgroundPresetId: 'clear-day',
        }),
      ),
    ).toBe(false);
    current = true;
    expect(
      await db!.transaction((trx) =>
        guardedRepository.publish(trx, operation, {
          outfits: outfits(),
          backgroundPresetId: 'clear-day',
        }),
      ),
    ).toBe(true);
    current = false;
    await expect(
      guarded.replace({
        outfitId: 'summer',
        garmentId: ids[0],
        replacementId: ids[3],
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'OUTFITS_STALE' });
    expect((await guarded.get()).revision).toBe(1);
  });
  it('refuses dispatch and publication when the deadline passes while waiting for the weather lock', async () => {
    let currentTime = now.getTime();
    let crossDeadline = false;
    const guardedRepository = createOutfitsRepository(db!, () => new Date(currentTime), {
      weatherCurrent: async () => {
        if (crossDeadline) currentTime = now.getTime() + 30001;
        return true;
      },
    });
    const guarded = createOutfitsService({
      enabled: true,
      repository: guardedRepository,
      operations: operations!,
      weather: { get: async () => weather },
      pricing: { model: 'fixture', revision: 'fixture', reserveMicroUsd: 1000 },
      clock: () => now,
    });
    const admitted = await guarded.start(randomUUID());
    const operation = await operations!.getInternal(admitted.id);
    crossDeadline = true;
    expect(await db!.transaction((trx) => guardedRepository.canDispatch(trx, operation))).toBe(
      false,
    );
    currentTime = now.getTime();
    expect(
      await db!.transaction((trx) =>
        guardedRepository.publish(trx, operation, {
          outfits: outfits(),
          backgroundPresetId: 'clear-day',
        }),
      ),
    ).toBe(false);
    expect((await guarded.get()).result).toBeNull();
  });
});
