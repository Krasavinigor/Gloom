import { describe, expect, it, vi } from 'vitest';
import { createOutfitProvider, OutfitProviderError, preflightOutfitSnapshot } from '../../src/server/outfits/provider';
import { outfitPricing, outfitReserveMicroUsd, outfitUsageCostMicroUsd } from '../../src/server/outfits/pricing';

const garment = { id: '00000000-0000-4000-8000-000000000001', photoId: 'private-photo-id', version: 1, createdAt: 'private-created', updatedAt: 'private-updated', fields: { name: 'Футболка', type: 't_shirt' as const, bodyAreas: ['torso' as const], seasons: ['summer' as const], layers: ['base' as const], color: 'Красный', pattern: '', warmth: 'light' as const, temperature: null, rainProtection: 'unknown' as const, windProtection: 'unknown' as const } };
const suggestion = { id: 'look-1', title: 'На прогулку', explanation: 'Лёгкий образ.', items: [{ garmentId: garment.id, role: 'base_top' }, { garmentId: '00000000-0000-4000-8000-000000000002', role: 'footwear' }] };
const snapshot = { garments: [garment], weather: { status: 'fresh' as const, locationVersion: 1, placeId: 'private-place-id', fetchedAt: null, period: { start: '2026-10-16T10:00:00Z', end: '2026-10-16T13:00:00Z', timezone: 'UTC' }, current: null, summary: { temperature: { min: 20, max: 22 }, apparentTemperature: { min: 19, max: 21 }, windSpeedMax: 10, windGustsMax: 15, precipitationMm: 0, precipitationProbabilityMax: 0, precipitationPeriod: { start: '2026-10-16T10:00:00Z', end: '2026-10-16T13:00:00Z' } }, message: null } };
function response(text = JSON.stringify({ suggestions: [suggestion] })) {
  return { id: 'resp_outfit', _request_id: 'req_outfit', status: 'completed', service_tier: 'default', usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 20 } }, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}
function setup(result: unknown = response()) {
  const create = vi.fn().mockResolvedValue(result);
  const generate = createOutfitProvider({ apiKey: 'fake', client: { responses: { create } } });
  return { create, generate, input: { snapshot, signal: new AbortController().signal } };
}

describe('OpenAI outfit adapter', () => {
  it('makes a single bounded strict request with garment descriptions and weather only', async () => {
    const { create, generate, input } = setup();
    expect(await generate(input)).toMatchObject({ suggestions: [suggestion], requestId: 'req_outfit', responseId: 'resp_outfit', usage: { inputTokens: 100, outputTokens: 50 } });
    expect(create).toHaveBeenCalledOnce();
    const [payload, options] = create.mock.calls[0];
    expect(payload).toMatchObject({ model: 'gpt-6-luna', store: false, service_tier: 'default', max_output_tokens: 2400, reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', strict: true } } });
    expect(options).toMatchObject({ signal: input.signal, maxRetries: 0, timeout: 30000 });
    const body = JSON.stringify(payload);
    expect(body).toContain(garment.id);
    expect(body).toContain('Футболка');
    for (const secret of ['private-photo-id', 'private-place-id', 'private-created', 'private-updated']) expect(body).not.toContain(secret);
    expect(payload).not.toHaveProperty('tools');
  });
  it.each(['bad json', JSON.stringify({ suggestions: [] }), JSON.stringify({ suggestions: [{ ...suggestion, items: [{ garmentId: garment.id, role: 'imaginary' }] }] })])('preserves billable metadata for invalid output %s', async (text) => {
    const { generate, input } = setup(response(text));
    expect(await generate(input)).toMatchObject({ suggestions: null, errorCode: 'invalid_output', usage: { inputTokens: 100 }, responseId: 'resp_outfit' });
  });
  it('preserves costs for refusal, truncation and malformed envelopes', async () => {
    const refused = setup({ ...response(), output: [{ type: 'message', content: [{ type: 'refusal' }] }] });
    expect(await refused.generate(refused.input)).toMatchObject({ suggestions: null, errorCode: 'refused', usage: { outputTokens: 50 } });
    const partial = setup({ ...response(), status: 'incomplete' });
    expect(await partial.generate(partial.input)).toMatchObject({ errorCode: 'incomplete', usage: { outputTokens: 50 } });
    const malformed = setup({ ...response(), output: null });
    expect(await malformed.generate(malformed.input)).toMatchObject({ errorCode: 'invalid_output', usage: { outputTokens: 50 } });
  });
  it('keeps absent cache breakdown unknown and rejects invalid usage', async () => {
    const missing = setup({ ...response(), usage: { input_tokens: 10, output_tokens: 5 } });
    expect((await missing.generate(missing.input)).usage).toMatchObject({ cachedInputTokens: null, cacheWriteTokens: null });
    const bad = setup({ ...response(), usage: { input_tokens: -1, output_tokens: 5 } });
    expect((await bad.generate(bad.input)).usage).toBeNull();
  });
  it('sanitizes provider failures without retrying', async () => {
    const { create, generate, input } = setup();
    create.mockRejectedValue({ request_id: 'req_fail', message: 'private prompt and secret' });
    await expect(generate(input)).rejects.toBeInstanceOf(OutfitProviderError);
    expect(create).toHaveBeenCalledOnce();
    try { await generate(input); } catch (error) { expect(String(error)).not.toContain('private prompt'); expect(error).toMatchObject({ code: 'provider_error', requestId: 'req_fail' }); }
  });
  it('preflights the identical prompt bound before paid admission or dispatch', () => {
    expect(() => preflightOutfitSnapshot(snapshot)).not.toThrow();
    expect(() => preflightOutfitSnapshot({ ...snapshot, garments: Array.from({ length: 1000 }, () => garment) })).toThrow('Outfit prompt exceeds');
  });
  it('rejects aborted calls and excessive prompt sizes before dispatch', async () => {
    const { generate, create, input } = setup();
    await expect(generate({ ...input, signal: AbortSignal.abort() })).rejects.toThrow();
    await expect(generate({ ...input, snapshot: { ...snapshot, garments: Array.from({ length: 1000 }, () => garment) } })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('outfit pricing', () => {
  it('reserves the entire context with long-context cache-write rates and margin', () => {
    expect(outfitPricing.maxOutputTokens).toBe(2400);
    expect(outfitReserveMicroUsd()).toBe(317160);
  });
  it('settles known caches and conservatively prices unknown details', () => {
    expect(outfitUsageCostMicroUsd({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 10, cacheWriteTokens: 20, serviceTier: 'default' })).toBe(35);
    expect(outfitUsageCostMicroUsd({ inputTokens: 100, outputTokens: 50, cachedInputTokens: null, cacheWriteTokens: null })).toBe(38);
    expect(outfitUsageCostMicroUsd({ inputTokens: 300000, outputTokens: 2000, cachedInputTokens: 0, cacheWriteTokens: 0 })).toBe(61500);
  });
  it('rejects impossible usage, unknown tiers and output beyond the cap', () => {
    const base = { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0 };
    for (const patch of [{ inputTokens: -1 }, { inputTokens: 1050001 }, { outputTokens: 2401 }, { serviceTier: 'fast' }, { cachedInputTokens: 101 }, { cachedInputTokens: 90, cacheWriteTokens: 20 }, { cacheWriteTokens: -1 }]) expect(() => outfitUsageCostMicroUsd({ ...base, ...patch })).toThrow();
  });
});
