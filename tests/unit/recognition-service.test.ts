import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRecognitionService } from '../../src/server/recognition/service';

const draftId = randomUUID();
const photoId = randomUUID();
function fixture(enabled = true) {
  const row = { id: draftId, photo_id: photoId };
  const query = { where: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(row) };
  const operationQuery = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(undefined),
  };
  const database = vi
    .fn()
    .mockImplementation((table: string) => (table === 'ai_operations' ? operationQuery : query));
  const repository = { admit: vi.fn().mockResolvedValue({ id: randomUUID(), status: 'queued' }) };
  const service = createRecognitionService({
    enabled,
    database: database as never,
    repository: repository as never,
  });
  return { service, repository, database, query, operationQuery };
}

describe('recognition admission service', () => {
  it('fails before querying the draft or admitting when AI is disabled', async () => {
    const { service, database, repository } = fixture(false);
    await expect(service.start(draftId, randomUUID())).rejects.toMatchObject({
      code: 'AI_DISABLED',
      status: 503,
    });
    expect(database).not.toHaveBeenCalledWith('garment_drafts');
    expect(repository.admit).not.toHaveBeenCalled();
  });

  it('binds a bounded reserve and deterministic payload hash to the validated photo', async () => {
    const { service, repository } = fixture();
    const key = randomUUID();
    await service.start(draftId, key);
    await service.start(draftId, key);
    const first = repository.admit.mock.calls[0][0];
    expect(first).toMatchObject({
      kind: 'recognition',
      targetId: draftId,
      idempotencyKey: key,
      payload: { draftId, photoId, outputLocale: 'en' },
    });
    expect(first.reserveMicroUsd).toBeGreaterThan(0);
    expect(first.reserveMicroUsd).toBeLessThan(1_000_000);
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.admit.mock.calls[1][0].payloadHash).toBe(first.payloadHash);
  });

  it('reuses an existing request after switching language without checking a consumed draft', async () => {
    const { service, repository, operationQuery, database } = fixture();
    const operation = { id: randomUUID(), kind: 'recognition', target_id: draftId };
    operationQuery.first.mockResolvedValue(operation);
    const get = vi.fn().mockResolvedValue({ id: operation.id });
    Object.assign(repository, { get });
    expect(await service.start(draftId, randomUUID(), 'ru')).toEqual({ id: operation.id });
    expect(database).not.toHaveBeenCalledWith('garment_drafts');
    expect(repository.admit).not.toHaveBeenCalled();
  });

  it('never admits a missing draft or a draft whose photo has been removed', async () => {
    const { service, repository, query } = fixture();
    query.first
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: draftId, photo_id: null } as never);
    await expect(service.start(draftId, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(service.start(draftId, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(repository.admit).not.toHaveBeenCalled();
  });
});
