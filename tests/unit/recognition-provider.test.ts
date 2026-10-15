import { describe, expect, it, vi } from 'vitest';
import { createRecognitionProvider, RecognitionProviderError } from '../../src/server/recognition/provider';

const fields = { name: 'Футболка', type: 't_shirt', bodyAreas: ['torso'], seasons: ['summer'], layers: ['base'], color: 'Красный', pattern: '', warmth: 'light', temperature: null, rainProtection: 'unknown', windProtection: 'unknown' };
function response(text = JSON.stringify({ kind: 'item', fields, warnings: [] })) {
  return { id: 'resp_test', _request_id: 'req_test', status: 'completed', service_tier: 'default',
    usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 20 } },
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}
function setup(result: unknown = response()) {
  const create = vi.fn().mockResolvedValue(result);
  const recognize = createRecognitionProvider({ apiKey: 'test-key', client: { responses: { create } } });
  return { create, recognize, input: { photo: Buffer.from([0xff, 0xd8, 0xff]), signal: new AbortController().signal } };
}

describe('OpenAI recognition adapter', () => {
  it('sends one bounded strict Responses request and preserves usage plus request identifiers', async () => {
    const { create, recognize, input } = setup();
    const result = await recognize(input);
    expect(result.proposal?.kind).toBe('item');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 10, cacheWriteTokens: 20, serviceTier: 'default' });
    expect(result.requestId).toBe('req_test');
    expect(result.responseId).toBe('resp_test');
    expect(create).toHaveBeenCalledOnce();
    const [payload, options] = create.mock.calls[0];
    expect(payload).toMatchObject({ model: 'gpt-6-luna', max_output_tokens: 1600, store: false, service_tier: 'default', reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', strict: true } } });
    expect(JSON.stringify(payload)).toContain('data:image/jpeg;base64,/9j/');
    expect(payload).not.toHaveProperty('tools');
    expect(options).toMatchObject({ signal: input.signal, timeout: 30000, maxRetries: 0 });
  });
  it('retains billable usage when JSON or semantic fields fail validation', async () => {
    for (const text of ['not json', JSON.stringify({ kind: 'item', fields: { ...fields, type: 'invented' }, warnings: [] })]) {
      const { recognize, input } = setup(response(text));
      expect(await recognize(input)).toMatchObject({ proposal: null, errorCode: 'invalid_output', usage: { inputTokens: 100 }, responseId: 'resp_test' });
    }
  });
  it('retains usage for refusal and truncated output', async () => {
    const refused = { ...response(), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] };
    const a = setup(refused);
    expect(await a.recognize(a.input)).toMatchObject({ proposal: null, errorCode: 'refused', usage: { outputTokens: 50 } });
    const b = setup({ ...response(), status: 'incomplete' });
    expect(await b.recognize(b.input)).toMatchObject({ proposal: null, errorCode: 'incomplete', usage: { outputTokens: 50 } });
  });
  it('rejects missing metadata safely and preserves missing cache detail as unknown', async () => {
    const a = setup({ ...response(), usage: { input_tokens: 10, output_tokens: 5 } });
    expect((await a.recognize(a.input)).usage).toMatchObject({ cachedInputTokens: null, cacheWriteTokens: null });
    const b = setup({ output: null });
    expect(await b.recognize(b.input)).toMatchObject({ proposal: null, errorCode: 'invalid_output', usage: null });
  });
  it('does not retry or expose a provider error body', async () => {
    const { create, recognize, input } = setup();
    create.mockRejectedValue({ message: 'secret private image', request_id: 'req_error' });
    await expect(recognize(input)).rejects.toMatchObject({ name: 'RecognitionProviderError', requestId: 'req_error', code: 'provider_error' });
    await recognize(input).catch((error: unknown) => { expect(error).toBeInstanceOf(RecognitionProviderError); expect(String(error)).not.toContain('private image'); });
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid photos and already aborted calls before dispatch', async () => {
    const { create, recognize, input } = setup();
    await expect(recognize({ ...input, photo: Buffer.from('not a jpeg') })).rejects.toThrow();
    await expect(recognize({ ...input, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
