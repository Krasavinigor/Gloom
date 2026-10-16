import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InternalOperation } from '../../src/server/operations/schema';
import { recognitionPricing } from '../../src/server/recognition/pricing';
import { runRecognitionOnce } from '../../src/worker/recognition-worker';

const now = new Date('2026-10-15T10:00:00Z');
const operation = (): InternalOperation => ({
  id: 'd987ad28-df2c-4c15-8000-5d7af368d226', kind: 'recognition', targetId: '1eab830e-35ad-4094-b03d-3145079817d5',
  status: 'running', statusRevision: 2, sendState: 'not_sent', settlementState: 'reserved',
  errorCode: null, createdAt: now.toISOString(), deadlineAt: new Date(+now + 30_000).toISOString(),
  payload: { draftId: '1eab830e-35ad-4094-b03d-3145079817d5', photoId: 'a26bbbd7-a5dc-4506-bf0d-f154dbbb1c91' },
  model: 'gpt-6-luna', pricingRevision: recognitionPricing.revision, admissionMonth: '2026-10', reserveMicroUsd: 316440,
  leaseOwner: 'test-worker', leaseExpiresAt: new Date(+now + 45_000).toISOString(), attempts: 1,
});
const proposal = { kind: 'not_clothing' as const, fields: null, warnings: ['На фотографии нет одежды.'] };
const usage = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, serviceTier: 'default' };
function fixture(overrides: Partial<InternalOperation> = {}) {
  const active = { ...operation(), ...overrides };
  const repository = {
    claim: vi.fn().mockResolvedValue(active),
    markDispatched: vi.fn().mockResolvedValue(true),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    load: vi.fn().mockResolvedValue(Buffer.from('private normalized photo')),
    isCurrent: vi.fn().mockResolvedValue(true),
    canDispatch: vi.fn().mockResolvedValue(true),
    publish: vi.fn().mockResolvedValue(true),
  };
  const provider = vi.fn().mockResolvedValue({ proposal, usage, requestId: 'req_1', responseId: 'resp_1' });
  return { repository, context, provider, workerId: 'test-worker', now: () => now };
}
afterEach(() => vi.useRealTimers());

describe('durable recognition worker dispatch', () => {
  it.each(['en', 'ru', undefined])('passes the captured language to the provider (%s)', async (locale) => {
    const deps = fixture({ payload: { ...operation().payload, ...(locale ? { outputLocale: locale } : {}) } });
    await runRecognitionOnce(deps);
    expect(deps.provider).toHaveBeenCalledWith(expect.objectContaining({ outputLocale: locale ?? 'ru' }));
  });
  it.each(['deadline', 'shutdown'])('settles a received response without publishing after %s', async (reason) => {
    const deps = fixture(); const stop = new AbortController(); let clock = now;
    deps.provider.mockImplementation(async () => {
      if (reason === 'deadline') clock = new Date(+now + 30_000);
      else stop.abort();
      return { proposal, usage, requestId: 'req_received', responseId: 'resp_received' };
    });
    await runRecognitionOnce({ ...deps, signal: stop.signal, now: () => clock });
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: reason === 'deadline' ? 'timed_out' : 'interrupted', actualCostMicroUsd: 15 });
    expect(deps.repository.finish.mock.calls[0][1].errorCode).toBe(reason === 'deadline' ? 'DEADLINE_EXCEEDED' : 'WORKER_STOPPED');
    expect(deps.repository.finish.mock.calls[0]).toHaveLength(2);
    expect(deps.context.publish).not.toHaveBeenCalled();
  });
  it('does nothing when the queue is empty', async () => {
    const deps = fixture();
    deps.repository.claim.mockResolvedValue(null);
    expect(await runRecognitionOnce(deps)).toBe(false);
    expect(deps.provider).not.toHaveBeenCalled();
  });
  it('reads only the normalized private photo, rechecks context, durably marks dispatch, then calls the provider once', async () => {
    const deps = fixture();
    expect(await runRecognitionOnce(deps)).toBe(true);
    expect(deps.context.load).toHaveBeenCalledWith(expect.objectContaining({ id: operation().id }));
    expect(deps.context.isCurrent).toHaveBeenCalledOnce();
    expect(deps.repository.markDispatched.mock.invocationCallOrder[0]).toBeLessThan(deps.provider.mock.invocationCallOrder[0]);
    expect(deps.provider).toHaveBeenCalledOnce();
    const [id, completion, publish] = deps.repository.finish.mock.calls[0];
    expect(id).toBe(operation().id);
    expect(completion).toMatchObject({ status: 'succeeded', actualCostMicroUsd: 15, requestId: 'req_1', responseId: 'resp_1' });
    const transaction = {};
    await publish(transaction);
    expect(deps.context.publish).toHaveBeenCalledWith(transaction, expect.objectContaining({ id }), proposal);
  });
  it.each(['photo', 'recheck'])('releases a stale target before dispatch (%s)', async (stage) => {
    const deps = fixture();
    if (stage === 'photo') deps.context.load.mockResolvedValue(null);
    else deps.context.isCurrent.mockResolvedValue(false);
    await runRecognitionOnce(deps);
    expect(deps.repository.markDispatched).not.toHaveBeenCalled();
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE' }));
  });
  it('does not dispatch an expired queued task', async () => {
    const deps = fixture({ deadlineAt: now.toISOString() });
    await runRecognitionOnce(deps);
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'timed_out' }));
  });
  it('fails closed when an old task carries a different model or pricing revision', async () => {
    const deps = fixture({ pricingRevision: 'old-pricing' });
    await runRecognitionOnce(deps);
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'failed', errorCode: 'PRICING_CHANGED' }));
  });
  it('keeps a photo read failure pre-dispatch and releases its reservation', async () => {
    const deps = fixture();
    deps.context.load.mockRejectedValue(new Error('file not found'));
    await runRecognitionOnce(deps);
    expect(deps.repository.markDispatched).not.toHaveBeenCalled();
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'failed', errorCode: 'PHOTO_UNAVAILABLE' }));
  });
  it('does not claim any task after worker shutdown', async () => {
    const deps = fixture();
    expect(await runRecognitionOnce({ ...deps, signal: AbortSignal.abort() })).toBe(false);
    expect(deps.repository.claim).not.toHaveBeenCalled();
  });
  it('settles no usage for a provider response with an unsupported billing tier', async () => {
    const deps = fixture();
    deps.provider.mockResolvedValue({ proposal, usage: { ...usage, serviceTier: 'priority' }, requestId: 'req_1', responseId: 'resp_1' });
    await runRecognitionOnce(deps);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', errorCode: 'USAGE_UNAVAILABLE' });
    expect(deps.repository.finish.mock.calls[0][1]).not.toHaveProperty('actualCostMicroUsd');
  });
  it('does not dispatch after a lost lease', async () => {
    const deps = fixture();
    deps.repository.markDispatched.mockResolvedValue(false);
    await runRecognitionOnce(deps);
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish).not.toHaveBeenCalled();
  });
  it('does not send a photograph when the draft is cancelled after its preliminary check', async () => {
    const deps = fixture();
    deps.context.canDispatch.mockResolvedValue(false);
    deps.repository.markDispatched.mockImplementation(async (_id, _owner, options) => options.validate({}));
    await runRecognitionOnce(deps);
    expect(deps.context.isCurrent).toHaveBeenCalledOnce();
    expect(deps.context.canDispatch).toHaveBeenCalledOnce();
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE' }));
    expect(deps.repository.finish.mock.calls[0][1]).not.toHaveProperty('actualCostMicroUsd');
  });
  it('settles known usage even when the received output is invalid', async () => {
    const deps = fixture();
    deps.provider.mockResolvedValue({ proposal: null, usage, requestId: 'req_1', responseId: 'resp_1', errorCode: 'invalid_output' });
    await runRecognitionOnce(deps);
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'failed', errorCode: 'invalid_output', actualCostMicroUsd: 15 }));
    expect(deps.context.publish).not.toHaveBeenCalled();
  });
  it('keeps the reservation unknown after a dispatch failure and never retries the provider', async () => {
    const deps = fixture();
    deps.provider.mockRejectedValue(new Error('upstream transport dropped'));
    await runRecognitionOnce(deps);
    expect(deps.provider).toHaveBeenCalledOnce();
    expect(deps.repository.finish).toHaveBeenCalledWith(operation().id, expect.objectContaining({ status: 'failed', errorCode: 'PROVIDER_ERROR' }));
    expect(deps.repository.finish.mock.calls[0][1]).not.toHaveProperty('actualCostMicroUsd');
  });
  it('retains unknown cost when a provider response lacks accountable usage', async () => {
    const deps = fixture();
    deps.provider.mockResolvedValue({ proposal, usage: null, requestId: 'req_1', responseId: 'resp_1' });
    await runRecognitionOnce(deps);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', errorCode: 'USAGE_UNAVAILABLE' });
    expect(deps.repository.finish.mock.calls[0][1]).not.toHaveProperty('actualCostMicroUsd');
  });
  it('aborts provider I/O at the deadline even when the provider ignores its abort signal', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    deps.provider.mockImplementation(() => new Promise(() => undefined));
    const work = runRecognitionOnce(deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await work;
    expect(deps.provider.mock.calls[0][0].signal.aborted).toBe(true);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'timed_out', errorCode: 'DEADLINE_EXCEEDED' });
  });
  it('stops on worker shutdown and preserves the potentially sent request as unknown', async () => {
    const deps = fixture();
    const stop = new AbortController();
    deps.provider.mockImplementation(() => new Promise(() => undefined));
    const work = runRecognitionOnce({ ...deps, signal: stop.signal });
    await vi.waitFor(() => expect(deps.provider).toHaveBeenCalledOnce());
    stop.abort();
    await work;
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'interrupted', errorCode: 'WORKER_STOPPED' });
  });
});
