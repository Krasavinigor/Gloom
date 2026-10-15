import { describe, expect, it } from 'vitest';
import { parseRecognitionEvidence } from '../../src/server/recognition/reconcile';
import { recognitionPricing } from '../../src/server/recognition/pricing';

const operation = { model: recognitionPricing.model, pricingRevision: recognitionPricing.revision };
const evidence = { id: 'resp_verified', model: recognitionPricing.model, service_tier: 'default', usage: {
  input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
} };
describe('offline usage reconciliation', () => {
  it('derives cost from bounded provider usage without an API call', () => {
    expect(parseRecognitionEvidence(evidence, operation)).toMatchObject({ responseId: 'resp_verified', actualCostMicroUsd: 150 });
  });
  it('uses the provider cache-write field instead of charging every input token at that rate', () => {
    const withCache = { ...evidence, usage: { ...evidence.usage, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 } } };
    expect(parseRecognitionEvidence(withCache, operation).actualCostMicroUsd).toBe(140);
  });
  it('fails closed for missing identifiers, wrong model/revision or unsupported usage', () => {
    expect(() => parseRecognitionEvidence({ ...evidence, id: '' }, operation)).toThrow();
    expect(() => parseRecognitionEvidence({ ...evidence, model: 'other' }, operation)).toThrow();
    expect(() => parseRecognitionEvidence(evidence, { ...operation, pricingRevision: 'old' })).toThrow();
    expect(() => parseRecognitionEvidence({ ...evidence, usage: { ...evidence.usage, output_tokens: 9000 } }, operation)).toThrow();
  });
});
