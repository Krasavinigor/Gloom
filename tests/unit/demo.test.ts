import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { demoItems, demoScenarios, getDemoItems, getDemoScenarios, getDemoItem } from '@/features/demo/fixtures';

describe('demonstration fixtures', () => {
  it('defaults to English and preserves identifiers and assets in Russian', () => {
    expect(getDemoItem('tee').name).toBe('Cream T-shirt');
    expect(getDemoItem('tee', 'ru').name).toBe('Молочная футболка');
    expect(getDemoItems('en').map(value => value.id)).toEqual(getDemoItems('ru').map(value => value.id));
    for (const locale of ['en', 'ru'] as const) {
      expect(getDemoScenarios(locale).map(value => value.id)).toEqual(['warm', 'wind', 'rain']);
      for (const scenario of getDemoScenarios(locale)) for (const outfit of scenario.outfits) {
        for (const id of outfit.itemIds) expect(getDemoItem(id, locale).image).toBe(getDemoItem(id).image);
      }
    }
    expect(() => getDemoItem('missing')).toThrow('Unknown demonstration garment');
  });
  it('keeps all outfit references inside the isolated wardrobe and ships every illustration', () => {
    expect(demoItems).toHaveLength(15);
    expect(new Set(demoItems.map(item => item.id)).size).toBe(15);
    for (const item of demoItems) expect(existsSync(join(process.cwd(), 'public', item.image))).toBe(true);
    for (const scenario of demoScenarios) {
      expect(existsSync(join(process.cwd(), 'public', scenario.background))).toBe(true);
      expect(scenario.outfits.length).toBeGreaterThanOrEqual(1);
      expect(scenario.outfits.length).toBeLessThanOrEqual(3);
      for (const outfit of scenario.outfits) {
        expect(new Set(outfit.itemIds).size).toBe(outfit.itemIds.length);
        for (const id of outfit.itemIds) expect(demoItems.some(item => item.id === id)).toBe(true);
        const parts = outfit.itemIds.map(id => demoItems.find(item => item.id === id)?.bodyPart);
        for (const part of ['torso', 'legs', 'feet']) expect(parts).toContain(part);
      }
    }
  });
});
