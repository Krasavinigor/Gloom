import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { demoItems, demoScenarios } from '@/features/demo/fixtures';

describe('demonstration fixtures', () => {
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
