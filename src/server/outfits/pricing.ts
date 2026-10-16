import type { RecognitionUsage } from '../recognition/pricing';

/** Standard global Responses rates, verified 2026-10-16 against official model/pricing docs. */
export const outfitPricing = Object.freeze({
  revision: 'openai-standard-2026-10-16',
  model: 'gpt-6-luna',
  maxContextTokens: 1_050_000,
  shortContextTokens: 272_000,
  maxOutputTokens: 2_400,
  // Rates in 1/1000 microUSD per token: $0.10 per million = 100/1000 microUSD.
  inputRate: 100,
  cachedRate: 10,
  cacheWriteRate: 125,
  outputRate: 500,
  longInputRate: 200,
  longCachedRate: 20,
  longCacheWriteRate: 250,
  longOutputRate: 750,
});

/** Full context bound avoids an additional token-count request with undocumented billing. */
export function outfitReserveMicroUsd() {
  const rates = outfitPricing;
  const milliMicroUsd = rates.maxContextTokens * rates.longCacheWriteRate
    + rates.maxOutputTokens * rates.longOutputRate;
  return Math.ceil(milliMicroUsd * 12 / 10_000);
}

function validTokens(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/** Rounded estimate from provider usage; missing cache details use the maximum input rate. */
export function outfitUsageCostMicroUsd(usage: RecognitionUsage) {
  const price = outfitPricing;
  if (!validTokens(usage.inputTokens, price.maxContextTokens)
    || !validTokens(usage.outputTokens, price.maxOutputTokens)
    || ![undefined, null, 'default'].includes(usage.serviceTier)) {
    throw new Error('Unsupported outfit usage or processing tier');
  }
  const long = usage.inputTokens > price.shortContextTokens;
  const inputRate = long ? price.longInputRate : price.inputRate;
  const writeRate = long ? price.longCacheWriteRate : price.cacheWriteRate;
  const cachedRate = long ? price.longCachedRate : price.cachedRate;
  const outputRate = long ? price.longOutputRate : price.outputRate;
  const cached = usage.cachedInputTokens;
  const writes = usage.cacheWriteTokens;
  if ((cached !== null && !validTokens(cached, usage.inputTokens))
    || (writes !== null && !validTokens(writes, usage.inputTokens))
    || (cached !== null && writes !== null && cached + writes > usage.inputTokens)) {
    throw new Error('Invalid outfit cache usage');
  }
  const inputCost = cached === null || writes === null
    ? usage.inputTokens * writeRate
    : (usage.inputTokens - cached - writes) * inputRate + cached * cachedRate + writes * writeRate;
  return Math.ceil((inputCost + usage.outputTokens * outputRate) / 1000);
}
