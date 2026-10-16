import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createOutfitHandlers } from '../../src/server/http/outfit-handlers';

const origin = 'http://127.0.0.1:3000';
const garmentId = randomUUID();
const operationId = randomUUID();
const key = randomUUID();
function fixture() {
  const view = {
    result: { outfits: [{ id: 'look-1', items: [{ role: 'footwear', garmentId }] }] },
    revision: 2,
  };
  const service = {
    get: vi.fn().mockResolvedValue(view),
    start: vi.fn().mockResolvedValue({ id: operationId }),
    alternatives: vi.fn().mockResolvedValue({ revision: 2, garments: [] }),
    replace: vi.fn().mockResolvedValue(view),
  };
  const runtime = vi.fn().mockResolvedValue(service);
  return { service, runtime, handlers: createOutfitHandlers(runtime as never) };
}
function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Host: '127.0.0.1:3000',
      Origin: origin,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
describe('outfit HTTP boundary', () => {
  it('admits only an explicit empty keyed command, returning202 without synchronous provider work', async () => {
    const { handlers, service } = fixture();
    const response = await handlers.start(request('/api/outfit-selections', 'POST', {}));
    expect(response.status).toBe(202);
    expect(service.start).toHaveBeenCalledWith(key, 'en');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('freezes the cookie locale for a new command', async () => {
    const { handlers, service } = fixture();
    const command = request('/api/outfit-selections', 'POST', {});
    command.headers.set('Cookie', 'gloom-locale=ru');
    expect((await handlers.start(command)).status).toBe(202);
    expect(service.start).toHaveBeenCalledWith(key, 'ru');
  });
  it('rejects client-supplied trusted snapshot and malformed identities before runtime', async () => {
    const { handlers, runtime } = fixture();
    expect(
      (await handlers.start(request('/api/outfit-selections', 'POST', { weather: {} }))).status,
    ).toBe(400);
    expect(
      (
        await handlers.alternatives(
          request('/api/outfit-result/look-1/alternatives?slot=garbage'),
          'look-1',
        )
      ).status,
    ).toBe(400);
    expect(runtime).not.toHaveBeenCalled();
  });
  it('resolves an alternative role using the saved result, never trusting a client target garment', async () => {
    const { handlers, service } = fixture();
    const response = await handlers.alternatives(
      request('/api/outfit-result/look-1/alternatives?slot=footwear'),
      'look-1',
    );
    expect(service.alternatives).toHaveBeenCalledWith('look-1', garmentId);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { revision: 2, candidates: [] },
    });
  });
  it('passes the expected revision and resolved current slot to a free replacement', async () => {
    const { handlers, service } = fixture();
    const replacementId = randomUUID();
    const response = await handlers.replace(
      request('/api/outfit-result/look-1/slots/footwear', 'PATCH', {
        expectedRevision: 2,
        garmentId: replacementId,
      }),
      'look-1',
      'footwear',
    );
    expect(response.status).toBe(200);
    expect(service.replace).toHaveBeenCalledWith(
      {
        outfitId: 'look-1',
        garmentId,
        replacementId,
        expectedRevision: 2,
      },
      'en',
    );
    expect(service.start).not.toHaveBeenCalled();
  });
  it('rejects a nonexistent outfit or slot without admitting AI', async () => {
    const { handlers, service } = fixture();
    expect(
      (
        await handlers.alternatives(
          request('/api/outfit-result/missing/alternatives?slot=footwear'),
          'missing',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handlers.alternatives(
          request('/api/outfit-result/look-1/alternatives?slot=outer'),
          'look-1',
        )
      ).status,
    ).toBe(404);
    expect(service.start).not.toHaveBeenCalled();
  });
});
