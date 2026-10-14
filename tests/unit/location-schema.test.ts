import { describe, expect, it } from 'vitest';
import { locationStateSchema, placeSchema, searchQuerySchema } from '../../src/features/location/schema';

export const place = {
  id: '524901', name: 'Москва', region: 'Москва', country: 'Россия', countryCode: 'RU',
  latitude: 55.75, longitude: 37.62, timezone: 'Europe/Moscow',
};

describe('location fields', () => {
  it('validates a complete place and rejects raw IP, extra fields and invalid coordinates', () => {
    expect(placeSchema.parse(place)).toEqual(place);
    for (const invalid of [
      { ...place, latitude: 91 }, { ...place, longitude: -181 }, { ...place, latitude: Infinity },
      { ...place, timezone: 'fake/timezone' }, { ...place, name: '' },
      { ...place, countryCode: 'ru' }, { ...place, ip: '203.0.113.1' },
    ]) expect(placeSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires place and source to coexist and versions to be nonnegative integers', () => {
    expect(locationStateSchema.parse({ place: null, source: null, locationVersion: 0 }).place).toBeNull();
    expect(locationStateSchema.parse({ place, source: 'manual', locationVersion: 3 }).source).toBe('manual');
    for (const invalid of [
      { place: null, source: 'manual', locationVersion: 0 },
      { place, source: null, locationVersion: 0 },
      { place, source: 'ip', locationVersion: -1 },
      { place, source: 'ip', locationVersion: 0.5 },
    ]) expect(locationStateSchema.safeParse(invalid).success).toBe(false);
  });
  it('normalizes query whitespace and limits length before provider calls', () => {
    expect(searchQuerySchema.parse('  New   York  ')).toBe('New York');
    for (const invalid of ['M', '', 'x'.repeat(101), 'ab\u0000cd']) {
      expect(searchQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });
});
