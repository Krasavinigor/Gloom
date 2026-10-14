import { describe, expect, it } from 'vitest';
import { garmentFieldsSchema, garmentTypeCatalog } from '../../src/features/wardrobe/schema';

const fields = { name: 'Рубашка', type: 'shirt', bodyAreas: ['torso'], seasons: ['summer'] };

describe('garment fields', () => {
  it('keeps explicit unknown properties and trims user descriptions', () => {
    expect(garmentFieldsSchema.parse({ ...fields, name: ' Рубашка ' })).toMatchObject({
      name: 'Рубашка',
      layers: [],
      temperature: null,
      warmth: 'unknown',
      rainProtection: 'unknown',
    });
  });
  it.each([
    { ...fields, name: '' },
    { ...fields, type: 'invented' },
    { ...fields, bodyAreas: [] },
    { ...fields, bodyAreas: ['torso', 'torso'] },
    { ...fields, seasons: [] },
    { ...fields, temperature: { min: 10, max: 0 } },
    { ...fields, temperature: { min: -61, max: 20 } },
    { ...fields, rainProtection: 'probably' },
    { ...fields, unexpected: true },
    { ...fields, type: 'sneakers', bodyAreas: ['feet'], layers: ['outer'] },
  ])('rejects an invalid card %#', (invalid) => {
    expect(garmentFieldsSchema.safeParse(invalid).success).toBe(false);
  });
  it('supports clothing covering multiple areas and unknown temperatures', () => {
    expect(
      garmentFieldsSchema.parse({ ...fields, type: 'dress', bodyAreas: ['torso', 'legs'] })
        .bodyAreas,
    ).toEqual(['torso', 'legs']);
    expect(garmentTypeCatalog.some((entry) => entry.value === 'other')).toBe(true);
  });
});
