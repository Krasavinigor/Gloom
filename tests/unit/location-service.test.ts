import { describe, expect, it, vi } from 'vitest';
import { createLocationWeatherService } from '../../src/server/location/service';
import type { Place } from '../../src/features/location/schema';

const place: Place = { id: '524901', name: 'Москва', region: 'Москва', country: 'Россия', countryCode: 'RU', latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow' };
function setup() {
  const location = { place, source: 'manual' as const, locationVersion: 1 };
  const repository = { get: vi.fn().mockResolvedValue(location), save: vi.fn().mockResolvedValue(location) };
  const geocoding = { search: vi.fn().mockResolvedValue([place]), findCachedPlace: vi.fn().mockResolvedValue(place) };
  const weather = { get: vi.fn().mockResolvedValue({ status: 'fresh', placeId: place.id, locationVersion: 1 }) };
  const service = createLocationWeatherService(repository, geocoding, weather);
  return { repository, geocoding, weather, service, location };
}

describe('selected place and weather service', () => {
  it('takes manual coordinates from verified search cache, never from the client', async () => {
    const { service, repository, geocoding } = setup();
    await service.select({ source: 'manual', query: 'Москва', placeId: place.id, expectedVersion: 1 });
    expect(geocoding.findCachedPlace).toHaveBeenCalledWith('Москва', place.id, 'ru');
    expect(repository.save).toHaveBeenCalledWith(place, 'manual', 1);
    geocoding.findCachedPlace.mockResolvedValue(null);
    await expect(service.select({ source: 'manual', query: 'Москва', placeId: 'invented', expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
    expect(repository.save).toHaveBeenCalledOnce();
  });
  it('validates IP candidates and rejects extra raw IP fields before saving', async () => {
    const { service, repository } = setup();
    await service.select({ source: 'ip', candidate: { ...place, id: 'ip' }, expectedVersion: 0 });
    expect(repository.save).toHaveBeenCalledWith({ ...place, id: 'ip' }, 'ip', 0);
    await expect(service.select({ source: 'ip', candidate: { ...place, id: 'ip', ip: '127.0.0.1' }, expectedVersion: 0 })).rejects.toThrow();
    expect(repository.save).toHaveBeenCalledOnce();
  });
  it('requires a selected place and rejects a stale version before provider calls', async () => {
    const { service, repository, weather } = setup();
    await expect(service.forecast(0)).rejects.toMatchObject({ status: 409 });
    expect(weather.get).not.toHaveBeenCalled();
    repository.get.mockResolvedValue({ place: null, source: null, locationVersion: 0 });
    await expect(service.forecast(0)).rejects.toMatchObject({ status: 400 });
  });
  it('refuses a late weather response after the user changes the city', async () => {
    const { service, repository, location } = setup();
    repository.get.mockResolvedValueOnce(location).mockResolvedValue({ ...location, locationVersion: 2 });
    await expect(service.forecast(1)).rejects.toMatchObject({ status: 409 });
  });
  it('provides coherent SSR context and leaves new city weather for a subsequent fetch on a race', async () => {
    const { service, repository, location, weather } = setup();
    const context = await service.context();
    expect(context.location).toEqual(location); expect(context.weather?.placeId).toBe(place.id);
    repository.get.mockResolvedValueOnce(location).mockResolvedValue({ ...location, locationVersion: 2 });
    expect((await service.context()).weather).toBeNull();
    repository.get.mockResolvedValue({ place: null, source: null, locationVersion: 0 });
    weather.get.mockClear();
    expect((await service.context()).weather).toBeNull();
    expect(weather.get).not.toHaveBeenCalled();
  });
});

it('preserves the captured search locale when choosing a cached result', async () => {
  const { service, geocoding } = setup();
  await service.select({ source: 'manual', query: 'Moscow', placeId: place.id, searchLocale: 'en', expectedVersion: 1 });
  expect(geocoding.findCachedPlace).toHaveBeenCalledWith('Moscow', place.id, 'en');
  await service.search('Moscow');
  expect(geocoding.search).toHaveBeenCalledWith('Moscow', 'en');
});
