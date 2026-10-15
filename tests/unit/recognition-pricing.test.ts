import { describe, expect, it } from 'vitest';
import { recognitionReserveMicroUsd, recognitionUsageCostMicroUsd, recognitionPricing } from '../../src/server/recognition/pricing';

describe('recognition pricing in integer microUSD', () => {
  it('reserves the full documented context at long-context cache-write price plus output and margin', () => {
    expect(recognitionReserveMicroUsd()).toBe(316_440);
    expect(recognitionPricing.model).toBe('gpt-6-luna');
  });
  it('charges uncached, cached and cache-write tokens separately with upward rounding', () => {
    expect(recognitionUsageCostMicroUsd({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, cacheWriteTokens: 300 })).toBe(140);
    expect(recognitionUsageCostMicroUsd({ inputTokens: 1, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 })).toBe(1);
  });
  it('applies long-context prices only above the documented input threshold', () => {
    expect(recognitionUsageCostMicroUsd({ inputTokens: 272000, outputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0 })).toBe(27250);
    expect(recognitionUsageCostMicroUsd({ inputTokens: 272001, outputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0 })).toBe(54476);
  });
  it('uses conservative cache-write rates when the provider omits cache breakdown', () => {
    expect(recognitionUsageCostMicroUsd({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: null, cacheWriteTokens: null })).toBe(175);
  });
  it('fails closed for invalid usage, unknown tiers or context/output beyond configured bounds', () => {
    const usage = { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0 };
    for (const value of [{ ...usage, inputTokens: -1 }, { ...usage, cachedInputTokens: 11 }, { ...usage, inputTokens: 1_050_001 }, { ...usage, outputTokens: 1601 }, { ...usage, serviceTier: 'fast' }]) {
      expect(() => recognitionUsageCostMicroUsd(value)).toThrow();
    }
  });
});
