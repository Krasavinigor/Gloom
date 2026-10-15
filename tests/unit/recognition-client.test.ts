import { afterEach, expect, it, vi } from 'vitest';
import { recognitionClient } from '../../src/features/recognition/client';
afterEach(() => vi.unstubAllGlobals());
it('sends explicit JSON with the attempt key, matching the production Route Handler boundary', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { id: 'operation' } }));
  vi.stubGlobal('fetch', fetch);
  await recognitionClient.start('draft', 'attempt');
  expect(fetch).toHaveBeenCalledWith('/api/garment-drafts/draft/recognition', expect.objectContaining({
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'attempt' },
  }));
});
