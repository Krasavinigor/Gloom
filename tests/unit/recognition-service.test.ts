import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRecognitionService } from '../../src/server/recognition/service';

const draftId = randomUUID();
const photoId = randomUUID();
function fixture(enabled = true) {
  const row = { id: draftId, photo_id: photoId };
  const query = { where: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(row) };
  const database = vi.fn().mockReturnValue(query);
  const repository = { admit: vi.fn().mockResolvedValue({ id: randomUUID(), status: 'queued' }) };
  const service = createRecognitionService({ enabled, database: database as never, repository: repository as never });
  return { service, repository, database, query };
}

describe('recognition admission service', () => {
  it('fails before querying or admitting when AI is disabled', async () => {
    const { service, database, repository } = fixture(false);
    await expect(service.start(draftId, randomUUID())).rejects.toMatchObject({ code: 'AI_DISABLED', status: 503 });
    expect(database).not.toHaveBeenCalled();
    expect(repository.admit).not.toHaveBeenCalled();
  });

  it('binds a bounded reserve and deterministic payload hash to the validated photo', async () => {
    const { service, repository } = fixture();
    const key = randomUUID();
    await service.start(draftId, key);
    await service.start(draftId, key);
    const first = repository.admit.mock.calls[0][0];
    expect(first).toMatchObject({ kind: 'recognition', targetId: draftId, idempotencyKey: key, payload: { draftId, photoId } });
    expect(first.reserveMicroUsd).toBeGreaterThan(0);
    expect(first.reserveMicroUsd).toBeLessThan(1_000_000);
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.admit.mock.calls[1][0].payloadHash).toBe(first.payloadHash);
  });

  it('never admits a missing draft or a draft whose photo has been removed', async () => {
    const { service, repository, query } = fixture();
    query.first.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: draftId, photo_id: null } as never);
    await expect(service.start(draftId, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(service.start(draftId, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(repository.admit).not.toHaveBeenCalled();
  });
});
