import { z } from 'zod';
import { recognitionPricing, recognitionUsageCostMicroUsd } from './pricing';
import { outfitPricing, outfitUsageCostMicroUsd } from '../outfits/pricing';

const tokens = z.number().int().nonnegative();
const evidenceSchema = z.object({
  id: z.string().regex(/^resp_[a-zA-Z0-9_-]+$/),
  request_id: z.string().regex(/^req_[a-zA-Z0-9_-]+$/).optional(),
  model: z.string(), service_tier: z.string().nullish(),
  usage: z.object({ input_tokens: tokens, output_tokens: tokens,
    input_tokens_details: z.object({ cached_tokens: tokens.nullish(), cache_write_tokens: tokens.nullish() }).nullish(),
  }),
});

/** Offline evidence only: this helper never retrieves or re-runs a provider request. */
export function parseRecognitionEvidence(input: unknown, operation: { model: string; pricingRevision: string }) {
  return parseAiUsageEvidence(input, { ...operation, kind: 'recognition' });
}

export function parseAiUsageEvidence(input: unknown, operation: { kind: 'recognition' | 'outfits'; model: string; pricingRevision: string }) {
  const pricing = operation.kind === 'outfits' ? outfitPricing : recognitionPricing;
  const evidence = evidenceSchema.parse(input);
  if (operation.pricingRevision !== pricing.revision || operation.model !== pricing.model
    || !(evidence.model === operation.model || new RegExp(`^${operation.model}-\\d{4}-\\d{2}-\\d{2}$`).test(evidence.model))) {
    throw new Error('Evidence does not match the admitted AI model and pricing.');
  }
  const usage = { inputTokens: evidence.usage.input_tokens, outputTokens: evidence.usage.output_tokens,
    cachedInputTokens: evidence.usage.input_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: evidence.usage.input_tokens_details?.cache_write_tokens ?? null,
    serviceTier: evidence.service_tier ?? null };
  const cost = operation.kind === 'outfits' ? outfitUsageCostMicroUsd : recognitionUsageCostMicroUsd;
  return { usage, actualCostMicroUsd: cost(usage), responseId: evidence.id,
    ...(evidence.request_id ? { requestId: evidence.request_id } : {}) };
}
