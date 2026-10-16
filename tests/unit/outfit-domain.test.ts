import { describe, expect, it } from 'vitest';
import type { Garment, GarmentFields } from '../../src/features/wardrobe/schema';
import type { WeatherSnapshot } from '../../src/features/weather/schema';
import type { OutfitSuggestion } from '../../src/features/outfits/schema';
import {
  preflightWardrobe,
  replacementAlternatives,
  roleForGarment,
  rolesForGarment,
  validateOutfit,
  validateOutfitSuggestions,
} from '../../src/features/outfits/validation';

const fields = (
  type: GarmentFields['type'],
  bodyAreas: GarmentFields['bodyAreas'],
  layers: GarmentFields['layers'] = [],
): GarmentFields => ({
  name: type,
  type,
  bodyAreas,
  layers,
  seasons: ['midseason'],
  color: '',
  pattern: '',
  warmth: 'medium',
  temperature: null,
  rainProtection: 'unknown',
  windProtection: 'unknown',
});
const garment = (id: string, f: GarmentFields): Garment => ({
  id,
  photoId: id,
  fields: f,
  version: 1,
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
});
const top = garment('top', fields('t_shirt', ['torso'], ['base']));
const bottom = garment('bottom', fields('trousers', ['legs'], ['base']));
const shoes = garment('shoes', fields('sneakers', ['feet']));
const middle = garment('middle', fields('sweater', ['torso'], ['middle']));
const outer = garment('outer', { ...fields('jacket', ['torso'], ['outer']), warmth: 'warm' });
const boots = garment('boots', { ...fields('boots', ['feet']), warmth: 'warm' });
const dress = garment('dress', fields('dress', ['torso', 'legs'], ['base']));
const all = [top, bottom, shoes, middle, outer, boots, dress];
const weather = (min = 20, max = min, rain = 0, probability = 0): WeatherSnapshot => ({
  status: 'fresh',
  locationVersion: 1,
  placeId: 'city',
  fetchedAt: '2026-10-16T00:00:00Z',
  period: { start: '2026-10-16T00:00:00Z', end: '2026-10-16T03:00:00Z', timezone: 'UTC' },
  current: null,
  summary: {
    temperature: { min, max },
    apparentTemperature: { min, max },
    windSpeedMax: 0,
    windGustsMax: 0,
    precipitationMm: rain,
    precipitationProbabilityMax: probability,
    precipitationPeriod: { start: '2026-10-16T00:00:00Z', end: '2026-10-16T03:00:00Z' },
  },
  message: null,
});
const outfit = (
  items: OutfitSuggestion['items'] = [
    { garmentId: 'top', role: 'base_top' },
    { garmentId: 'bottom', role: 'bottom' },
    { garmentId: 'shoes', role: 'footwear' },
  ],
): OutfitSuggestion => ({ id: 'outfit', title: 'Повседневный', explanation: 'По погоде', items });
const add = (
  base: OutfitSuggestion,
  garmentId: string,
  role: OutfitSuggestion['items'][number]['role'],
) => ({ ...base, items: [...base.items, { garmentId, role }] });

describe('outfit domain', () => {
  it('accepts complete base coverage and does not mutate inputs', () => {
    const source = outfit();
    const before = JSON.stringify(source);
    expect(validateOutfit(source, all, weather())).toMatchObject({
      valid: true,
      outfit: { conditional: false, warnings: [] },
    });
    expect(JSON.stringify(source)).toBe(before);
  });
  it('accepts a whole garment with footwear but rejects overlapping base clothes', () => {
    const whole = outfit([
      { garmentId: 'dress', role: 'whole' },
      { garmentId: 'shoes', role: 'footwear' },
    ]);
    expect(validateOutfit(whole, all, weather()).valid).toBe(true);
    expect(validateOutfit(add(whole, 'top', 'base_top'), all, weather()).valid).toBe(false);
  });
  it('rejects nonexistent, duplicate, incorrectly assigned and duplicate-role garments', () => {
    for (const candidate of [
      add(outfit(), 'missing', 'headwear'),
      add(outfit(), 'top', 'middle'),
      outfit([
        { garmentId: 'outer', role: 'base_top' },
        { garmentId: 'bottom', role: 'bottom' },
        { garmentId: 'shoes', role: 'footwear' },
      ]),
      add(outfit(), 'boots', 'footwear'),
    ]) {
      expect(validateOutfit(candidate, all, weather()).valid).toBe(false);
    }
  });
  it('derives roles from catalog and actual fields together', () => {
    expect(roleForGarment(top)).toBe('base_top');
    expect(roleForGarment(garment('outer-top', { ...top.fields, layers: ['outer'] }))).toBe(
      'outer',
    );
    expect(roleForGarment(garment('wrong', { ...top.fields, bodyAreas: ['feet'] }))).toBeNull();
    expect(roleForGarment(garment('other', fields('other', ['torso'], ['base'])))).toBeNull();
    expect(roleForGarment(garment('hat', fields('beanie', ['head'])))).toBe('headwear');
  });
  it('checks 0 and 10 degree cold boundaries with the minimum apparent temperature', () => {
    const warm = add(
      add(
        outfit([
          { garmentId: 'top', role: 'base_top' },
          { garmentId: 'bottom', role: 'bottom' },
          { garmentId: 'boots', role: 'footwear' },
        ]),
        'middle',
        'middle',
      ),
      'outer',
      'outer',
    );
    expect(validateOutfit(warm, all, weather(0, 15)).valid).toBe(true);
    expect(validateOutfit(add(outfit(), 'outer', 'outer'), all, weather(0)).valid).toBe(false);
    expect(validateOutfit(add(outfit(), 'outer', 'outer'), all, weather(0.1)).valid).toBe(true);
    expect(validateOutfit(outfit(), all, weather(9.9)).valid).toBe(false);
    expect(validateOutfit(outfit(), all, weather(10))).toMatchObject({
      valid: true,
      outfit: { warnings: [{ code: 'REMOVABLE_LAYER' }] },
    });
    expect(validateOutfit(outfit(), all, weather(18))).toMatchObject({
      valid: true,
      outfit: { warnings: [] },
    });
  });
  it('does not accept sandals as closed footwear', () => {
    const sandals = garment('sandals', fields('sandals', ['feet']));
    const candidate = add(
      outfit([
        { garmentId: 'top', role: 'base_top' },
        { garmentId: 'bottom', role: 'bottom' },
        { garmentId: 'sandals', role: 'footwear' },
      ]),
      'outer',
      'outer',
    );
    expect(validateOutfit(candidate, [...all, sandals], weather(5)).valid).toBe(false);
  });
  it.each([
    [0.1, 0],
    [0, 50],
  ])('marks rain protection unknown or absent as conditional (%s,%s)', (rain, probability) => {
    const candidate = add(outfit(), 'outer', 'outer');
    const result = validateOutfit(candidate, all, weather(20, 20, rain, probability));
    expect(result).toMatchObject({ valid: true, outfit: { conditional: true } });
    if (result.valid)
      expect(
        result.outfit.warnings.filter((warning) => warning.code === 'RAIN_PROTECTION'),
      ).toHaveLength(2);
    const protectedAll = all.map((g) =>
      ['shoes', 'outer'].includes(g.id)
        ? { ...g, fields: { ...g.fields, rainProtection: 'confirmed' as const } }
        : g,
    );
    expect(
      validateOutfit(candidate, protectedAll, weather(20, 20, rain, probability)),
    ).toMatchObject({ valid: true, outfit: { conditional: false } });
  });
  it('makes a rainy outfit without outerwear conditional and honors confirmed absence', () => {
    expect(validateOutfit(outfit(), all, weather(20, 20, 1))).toMatchObject({
      valid: true,
      outfit: { conditional: true },
    });
    const absent = all.map((g) => ({
      ...g,
      fields: { ...g.fields, rainProtection: 'absent' as const },
    }));
    expect(
      validateOutfit(add(outfit(), 'outer', 'outer'), absent, weather(20, 20, 1)),
    ).toMatchObject({ valid: true, outfit: { conditional: true } });
  });
  it('warns about approximate temperature ranges individually rather than summing or intersecting', () => {
    const limited = all.map((g) => ({
      ...g,
      fields: { ...g.fields, temperature: { min: 12, max: 15 } },
    }));
    const result = validateOutfit(outfit(), limited, weather(10, 22));
    expect(result.valid).toBe(true);
    if (result.valid)
      expect(result.outfit.warnings.some((warning) => warning.code === 'TEMPERATURE_RANGE')).toBe(
        true,
      );
  });
  it('returns only distinct valid compositions, irrespective of ordering and IDs', () => {
    const source = outfit();
    const result = validateOutfitSuggestions(
      [
        source,
        { ...source, id: 'two', items: [...source.items].reverse() },
        add(source, 'missing', 'headwear'),
        {
          ...source,
          id: 'three',
          items: source.items.map((i) =>
            i.role === 'footwear' ? { ...i, garmentId: 'boots' } : i,
          ),
        },
      ],
      all,
      weather(),
    );
    expect(result).toHaveLength(2);
  });
  it('proves absence of a complete combination before provider admission', () => {
    expect(preflightWardrobe([], weather())).toMatchObject({ complete: false });
    expect(preflightWardrobe([top, shoes], weather())).toMatchObject({ complete: false });
    expect(preflightWardrobe([top, bottom, shoes], weather(0))).toMatchObject({ complete: false });
    expect(preflightWardrobe(all, weather(0))).toEqual({ complete: true, missing: [] });
    expect(preflightWardrobe([dress, shoes], weather())).toEqual({ complete: true, missing: [] });
    expect(preflightWardrobe(all, { ...weather(), summary: null })).toMatchObject({
      complete: false,
    });
  });
  it('offers replacement of the same role and revalidates all weather rules', () => {
    expect(replacementAlternatives(outfit(), 'shoes', all, weather()).map((g) => g.id)).toEqual([
      'boots',
    ]);
    expect(
      replacementAlternatives(
        outfit([
          { garmentId: 'dress', role: 'whole' },
          { garmentId: 'shoes', role: 'footwear' },
        ]),
        'dress',
        all,
        weather(),
      ),
    ).toEqual([]);
    expect(replacementAlternatives(outfit(), 'missing', all, weather())).toEqual([]);
    expect(replacementAlternatives(outfit(), 'shoes', all, weather(0))).toEqual([]);
  });
  it('replaces items in a published outfit with derived warnings without trusting those warnings', () => {
    const validated = validateOutfit(outfit(), all, weather(20, 20, 1));
    expect(validated.valid).toBe(true);
    if (!validated.valid) throw new Error('Expected a complete outfit');
    expect(
      replacementAlternatives(validated.outfit, 'shoes', all, weather(20, 20, 1)).map((g) => g.id),
    ).toEqual(['boots']);
  });
  it('keeps unique outfit IDs as well as unique compositions', () => {
    const first = outfit();
    const second = {
      ...first,
      items: first.items.map((item) =>
        item.role === 'footwear' ? { ...item, garmentId: 'boots' } : item,
      ),
    };
    expect(
      validateOutfitSuggestions([first, second], all, weather()).map((value) => value.id),
    ).toEqual(['outfit']);
    expect(
      validateOutfitSuggestions([first, { ...second, id: 'different' }], all, weather()),
    ).toHaveLength(2);
  });
  it('does not let a discarded composition consume an ID belonging to a distinct valid outfit', () => {
    const first = outfit();
    const repeated = { ...first, id: 'second', items: [...first.items].reverse() };
    const distinct = {
      ...first,
      id: 'second',
      items: first.items.map((item) =>
        item.role === 'footwear' ? { ...item, garmentId: 'boots' } : item,
      ),
    };
    expect(validateOutfitSuggestions([first, repeated, distinct], all, weather())).toHaveLength(2);
  });
  it('chooses exactly one user-declared role of flexible torso layers', () => {
    const flexible = garment('flexible', fields('shirt', ['torso'], ['base', 'middle']));
    expect(rolesForGarment(flexible)).toEqual(['base_top', 'middle']);
    const asMiddle = add(outfit(), 'flexible', 'middle');
    expect(validateOutfit(asMiddle, [...all, flexible], weather()).valid).toBe(true);
    expect(
      validateOutfit(add(asMiddle, 'flexible', 'base_top'), [...all, flexible], weather()).valid,
    ).toBe(false);
    const layeredJacket = garment('layered-jacket', {
      ...outer.fields,
      layers: ['base', 'middle', 'outer'],
    });
    expect(rolesForGarment(layeredJacket)).toEqual(['middle', 'outer']);
    expect(rolesForGarment(layeredJacket)).not.toContain('base_top');
    expect(
      replacementAlternatives(
        add(outfit(), 'middle', 'middle'),
        'middle',
        [...all, flexible],
        weather(),
      ).map((value) => value.id),
    ).toContain('flexible');
  });
  it('matches required layers to distinct garments rather than counting the same flexible item twice', () => {
    const flexible = garment('flexible', {
      ...fields('shirt', ['torso'], ['base', 'outer']),
      warmth: 'warm',
    });
    expect(preflightWardrobe([flexible, bottom, shoes], weather(5)).complete).toBe(false);
    expect(preflightWardrobe([top, flexible, bottom, shoes], weather(5)).complete).toBe(true);
    const coldFlexible = garment('cold-flexible', {
      ...flexible.fields,
      layers: ['base', 'middle', 'outer'],
    });
    expect(preflightWardrobe([coldFlexible, bottom, boots], weather(0)).complete).toBe(false);
    expect(preflightWardrobe([coldFlexible, top, middle, bottom, boots], weather(0)).complete).toBe(
      true,
    );
  });
});
