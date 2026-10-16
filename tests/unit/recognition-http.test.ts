import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRecognitionHandlers } from '../../src/server/http/recognition-handlers';

const id = randomUUID();
const key = randomUUID();
const url = 'http://127.0.0.1:3000';
function fixture() {
  const runtime = {
    recognition: { start: vi.fn().mockResolvedValue({ id, status: 'queued' }) },
    repository: {
      get: vi.fn().mockResolvedValue({ id }),
      budget: vi.fn().mockResolvedValue({ remainingMicroUsd: 123 }),
    },
  };
  const getRuntime = vi.fn().mockResolvedValue(runtime);
  return { ...runtime, getRuntime, handlers: createRecognitionHandlers(getRuntime as never) };
}
const post = (headers: Record<string, string> = {}) =>
  new Request(`${url}/api/garment-drafts/${id}/recognition`, {
    method: 'POST',
    headers: { Host: '127.0.0.1:3000', Origin: url, 'Idempotency-Key': key, ...headers },
  });

describe('recognition HTTP boundary', () => {
  it('admits only an explicit same-origin keyed request and returns 202', async () => {
    const { handlers, recognition } = fixture();
    const response = await handlers.start(post(), id);
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(recognition.start).toHaveBeenCalledWith(id, key, 'en');
    expect(await response.json()).toMatchObject({ success: true, data: { id } });
  });
  it('reads the chosen locale from the cookie and localizes validation failures', async () => {
    const { handlers, recognition } = fixture();
    await handlers.start(post({ Cookie: 'gloom-locale=ru' }), id);
    expect(recognition.start).toHaveBeenCalledWith(id, key, 'ru');
    const response = await handlers.start(
      post({ Cookie: 'gloom-locale=ru', 'Idempotency-Key': '' }),
      id,
    );
    expect(await response.json()).toMatchObject({
      error: {
        code: 'invalid_fields',
        message: 'Проверьте поля карточки: значения не соответствуют требованиям.',
      },
    });
  });
  it('rejects cross-origin, missing/invalid key and malformed target without runtime work', async () => {
    const { handlers, getRuntime } = fixture();
    expect((await handlers.start(post({ Origin: 'https://other.example' }), id)).status).toBe(403);
    expect((await handlers.start(post({ 'Idempotency-Key': '' }), id)).status).toBe(400);
    expect((await handlers.start(post(), 'wrong')).status).toBe(400);
    expect(getRuntime).not.toHaveBeenCalled();
  });
  it('diagnostic GET reads only existing operations and budget', async () => {
    const { handlers, recognition, repository } = fixture();
    expect(
      (
        await handlers.get(
          new Request(`${url}/api/operations/${id}`, { headers: { Host: '127.0.0.1:3000' } }),
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handlers.budget(
          new Request(`${url}/api/ai-budget`, { headers: { Host: '127.0.0.1:3000' } }),
        )
      ).status,
    ).toBe(200);
    expect(repository.get).toHaveBeenCalledWith(id);
    expect(recognition.start).not.toHaveBeenCalled();
  });
  it('bounds the SSE subscription before opening any listener', async () => {
    const { handlers, getRuntime } = fixture();
    for (const ids of [
      '',
      'wrong',
      Array.from({ length: 21 }, () => randomUUID()).join(','),
      `${id},${id}`,
    ]) {
      expect(
        (
          await handlers.events(
            new Request(`${url}/api/operation-events?ids=${ids}`, {
              headers: { Host: '127.0.0.1:3000' },
            }),
          )
        ).status,
      ).toBe(400);
    }
    expect(getRuntime).not.toHaveBeenCalled();
  });
});
