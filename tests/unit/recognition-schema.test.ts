import { describe, expect, it } from 'vitest';
import { recognitionProposalSchema } from '../../src/features/recognition/schema';

export const itemFields = {
  name: 'Красная футболка', type: 't_shirt', bodyAreas: ['torso'], seasons: ['summer'],
  layers: ['base'], color: 'Красный', pattern: '', warmth: 'light', temperature: { min: 18, max: 28 },
  rainProtection: 'unknown', windProtection: 'unknown',
};

describe('recognition proposal', () => {
  it('validates fields and leaves uncertain protection unknown', () => {
    const result = recognitionProposalSchema.parse({ kind: 'item', fields: { ...itemFields, rainProtection: 'confirmed', windProtection: 'absent' }, warnings: [] });
    expect(result.fields?.rainProtection).toBe('unknown');
    expect(result.fields?.windProtection).toBe('unknown');
    expect(itemFields.rainProtection).toBe('unknown');
  });
  it('rejects incompatible layers, reversed ranges and missing item fields', () => {
    for (const fields of [null, { ...itemFields, temperature: { min: 25, max: 10 } }, { ...itemFields, type: 'sneakers', layers: ['base'] }]) {
      expect(recognitionProposalSchema.safeParse({ kind: 'item', fields, warnings: [] }).success).toBe(false);
    }
  });
  it('separates non-garments and multiple garments without fictional fields', () => {
    expect(recognitionProposalSchema.parse({ kind: 'multiple_items', fields: null, warnings: [] }).fields).toBeNull();
    expect(recognitionProposalSchema.safeParse({ kind: 'not_clothing', fields: itemFields, warnings: [] }).success).toBe(false);
    expect(recognitionProposalSchema.safeParse({ kind: 'item', fields: itemFields, warnings: ['x'.repeat(321)] }).success).toBe(false);
  });
});
