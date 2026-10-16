import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InternalOperation } from '../../src/server/operations/schema';
import { preflightOutfitSnapshot } from '../../src/server/outfits/provider';
import { outfitPricing } from '../../src/server/outfits/pricing';
import { validateOutfitSuggestions } from '../../src/features/outfits/validation';
import { runOutfitOnce } from '../../src/worker/outfit-worker';

vi.mock('../../src/server/outfits/provider', () => ({ preflightOutfitSnapshot: vi.fn() }));
vi.mock('../../src/features/outfits/validation', () => ({
  validateOutfitSuggestions: vi.fn(() => [{ id: 'look-1', title: 'Образ', items: [{ garmentId: 'one', role: 'whole' }, { garmentId: 'two', role: 'footwear' }], explanation: 'Подходит.', warnings: [], conditional: false }]),
}));
vi.mock('../../src/server/outfits/repository', () => ({
  parseOutfitOperationPayload: vi.fn((payload) => payload?.snapshot ? payload : null),
}));
vi.mock('../../src/features/backgrounds/catalog', () => ({ selectBackground: () => 'clear-day' }));
const now = new Date('2026-10-16T10:00:00Z');
const usage = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, serviceTier: 'default' };
const operation = (): InternalOperation => ({
  id: 'd987ad28-df2c-4c15-8000-5d7af368d226', kind: 'outfits', targetId: '1eab830e-35ad-4094-b03d-3145079817d5',
  status: 'running', statusRevision: 2, sendState: 'not_sent', settlementState: 'reserved',
  errorCode: null, createdAt: now.toISOString(), deadlineAt: new Date(+now + 30_000).toISOString(),
  payload: { snapshot: { garments: [], weather: {}, wardrobeVersion: 1, locationVersion: 1 }, expectedRevision: 0 },
  model: outfitPricing.model, pricingRevision: outfitPricing.revision, admissionMonth: '2026-10', reserveMicroUsd: 317160,
  leaseOwner: 'test-worker', leaseExpiresAt: new Date(+now + 45_000).toISOString(), attempts: 1,
});
function fixture(overrides: Partial<InternalOperation> = {}) {
  const repository = { claim: vi.fn().mockResolvedValue({ ...operation(), ...overrides }), markDispatched: vi.fn().mockResolvedValue(true), finish: vi.fn().mockResolvedValue(undefined) };
  const context = { canDispatch: vi.fn().mockResolvedValue(true), publish: vi.fn().mockResolvedValue(true) };
  const provider = vi.fn().mockResolvedValue({ suggestions: [{ id: 'look-1', title: 'Образ', items: [{ garmentId: 'one', role: 'whole' }, { garmentId: 'two', role: 'footwear' }], explanation: 'Подходит.' }], usage, requestId: 'req_1', responseId: 'resp_1' });
  return { repository, context, provider, workerId: 'test-worker', now: () => now };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('durable outfits worker', () => {
  it('claims only outfits, publishes checked results and accounts usage', async () => {
    const deps = fixture();
    expect(await runOutfitOnce(deps)).toBe(true);
    expect(deps.repository.claim).toHaveBeenCalledWith('test-worker', { now, leaseMs: 45_000, kinds: ['outfits'] });
    expect(deps.repository.markDispatched.mock.invocationCallOrder[0]).toBeLessThan(deps.provider.mock.invocationCallOrder[0]);
    const [id, completion, publish] = deps.repository.finish.mock.calls[0];
    expect(completion).toMatchObject({ status: 'succeeded', actualCostMicroUsd: 15, requestId: 'req_1' });
    await publish({});
    expect(deps.context.publish).toHaveBeenCalledWith({}, expect.objectContaining({ id }), expect.objectContaining({ backgroundPresetId: 'clear-day' }));
  });
  it.each(['deadline', 'shutdown'])('settles a received response without publishing after %s', async (reason) => {
    const deps = fixture(); const stop = new AbortController(); let clock = now;
    deps.provider.mockImplementation(async () => {
      if (reason === 'deadline') clock = new Date(+now + 30_000);
      else stop.abort();
      return { suggestions: [{ id: 'late', title: 'Late', explanation: 'Late', items: [] }], usage, requestId: 'req_received', responseId: 'resp_received' };
    });
    await runOutfitOnce({ ...deps, signal: stop.signal, now: () => clock });
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: reason === 'deadline' ? 'timed_out' : 'interrupted', actualCostMicroUsd: 15 });
    expect(deps.repository.finish.mock.calls[0][1].errorCode).toBe(reason === 'deadline' ? 'DEADLINE_EXCEEDED' : 'WORKER_STOPPED');
    expect(deps.repository.finish.mock.calls[0]).toHaveLength(2);
    expect(deps.context.publish).not.toHaveBeenCalled();
  });
  it('does nothing for an empty queue or a stopped worker', async () => {
    const deps = fixture(); deps.repository.claim.mockResolvedValue(null);
    expect(await runOutfitOnce(deps)).toBe(false);
    expect(await runOutfitOnce({ ...deps, signal: AbortSignal.abort() })).toBe(false);
    expect(deps.repository.claim).toHaveBeenCalledOnce();
  });
  it.each([
    [{ pricingRevision: 'old' }, 'PRICING_CHANGED'],
    [{ deadlineAt: now.toISOString() }, 'DEADLINE_EXCEEDED'],
    [{ payload: null }, 'INVALID_OPERATION_PAYLOAD'],
    [{ kind: 'recognition' }, 'INVALID_OPERATION_PAYLOAD'],
  ] as const)('fails closed before dispatch for %s', async (overrides, errorCode) => {
    const deps = fixture(overrides); await runOutfitOnce(deps);
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ errorCode });
    expect(deps.repository.finish.mock.calls[0][1]).not.toHaveProperty('actualCostMicroUsd');
  });
  it('rejects locally oversized input before marking it as potentially sent', async () => {
    const deps = fixture(); vi.mocked(preflightOutfitSnapshot).mockImplementationOnce(() => { throw new Error('Input too large'); });
    await runOutfitOnce(deps);
    expect(deps.repository.markDispatched).not.toHaveBeenCalled(); expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', errorCode: 'INVALID_OPERATION_PAYLOAD' });
  });
  it('does not dispatch when snapshot becomes stale while acquiring locks', async () => {
    const deps = fixture(); deps.context.canDispatch.mockResolvedValue(false);
    deps.repository.markDispatched.mockImplementation(async (_id, _owner, options) => options.validate({}));
    await runOutfitOnce(deps);
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'interrupted', errorCode: 'TARGET_UNAVAILABLE' });
  });
  it('does not finish or dispatch when lease ownership was lost', async () => {
    const deps = fixture(); deps.repository.markDispatched.mockResolvedValue(false);
    await runOutfitOnce(deps);
    expect(deps.provider).not.toHaveBeenCalled(); expect(deps.repository.finish).not.toHaveBeenCalled();
  });
  it('never dispatches after an uncertain dispatch-marker transaction', async () => {
    const deps = fixture(); deps.repository.markDispatched.mockRejectedValue(new Error('uncertain commit'));
    await expect(runOutfitOnce(deps)).rejects.toThrow('uncertain commit');
    expect(deps.provider).not.toHaveBeenCalled(); expect(deps.repository.finish).not.toHaveBeenCalled();
  });
  it('releases an admitted task if shutdown happens while claiming it', async () => {
    const deps = fixture(); const stop = new AbortController();
    deps.repository.claim.mockImplementation(async () => { stop.abort(); return operation(); });
    await runOutfitOnce({ ...deps, signal: stop.signal });
    expect(deps.provider).not.toHaveBeenCalled();
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'interrupted', errorCode: 'WORKER_STOPPED' });
  });
  it('preserves the provider request identifier on transport failure without storing the error body', async () => {
    const deps = fixture();
    deps.provider.mockRejectedValue(Object.assign(new Error('private upstream body'), { requestId: 'req_lost' }));
    await runOutfitOnce(deps);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ errorCode: 'PROVIDER_ERROR', requestId: 'req_lost' });
    expect(JSON.stringify(deps.repository.finish.mock.calls)).not.toContain('private upstream body');
  });
  it('retains unknown cost without retry after provider failure', async () => {
    const deps = fixture(); deps.provider.mockRejectedValue(new Error('connection closed'));
    await runOutfitOnce(deps);
    expect(deps.provider).toHaveBeenCalledOnce();
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_ERROR' });
    expect(deps.repository.finish.mock.calls[0][1]).not.toHaveProperty('actualCostMicroUsd');
  });
  it('retains unknown cost when usage cannot be priced', async () => {
    const deps = fixture(); deps.provider.mockResolvedValue({ suggestions: [], usage: null, requestId: null, responseId: null });
    await runOutfitOnce(deps);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ errorCode: 'USAGE_UNAVAILABLE' });
  });
  it('settles received usage even for rejected output', async () => {
    const deps = fixture(); deps.provider.mockResolvedValue({ suggestions: null, usage, requestId: null, responseId: null, errorCode: 'invalid_output' });
    await runOutfitOnce(deps);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', actualCostMicroUsd: 15, errorCode: 'invalid_output' });
    expect(deps.context.publish).not.toHaveBeenCalled();
  });
  it('settles usage but rejects a response whose candidates all fail server checks', async () => {
    vi.mocked(validateOutfitSuggestions).mockReturnValueOnce([]);
    const deps = fixture(); await runOutfitOnce(deps);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'failed', errorCode: 'INVALID_AI_RESPONSE', actualCostMicroUsd: 15 });
    expect(deps.repository.finish.mock.calls[0]).toHaveLength(2);
  });
  it('publishes only the valid subset, with publication deferred to the settlement transaction', async () => {
    const valid = { id: 'kept', title: 'Образ', explanation: 'Проверено.', items: [{ garmentId: 'one', role: 'whole' as const }, { garmentId: 'two', role: 'footwear' as const }], warnings: [], conditional: false };
    vi.mocked(validateOutfitSuggestions).mockReturnValueOnce([valid]);
    const deps = fixture(); await runOutfitOnce(deps);
    expect(deps.context.publish).not.toHaveBeenCalled();
    await deps.repository.finish.mock.calls[0][2]({});
    expect(deps.context.publish.mock.calls[0][2].outfits).toEqual([valid]);
  });
  it('aborts a non-cooperative provider at deadline and keeps unknown cost', async () => {
    vi.useFakeTimers(); const deps = fixture(); deps.provider.mockImplementation(() => new Promise(() => undefined));
    const work = runOutfitOnce(deps); await vi.advanceTimersByTimeAsync(30_000); await work;
    expect(deps.provider.mock.calls[0][0].signal.aborted).toBe(true);
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'timed_out', errorCode: 'DEADLINE_EXCEEDED' });
  });
  it('retains unknown cost when stopping in-flight work', async () => {
    const deps = fixture(); const stop = new AbortController(); deps.provider.mockImplementation(() => new Promise(() => undefined));
    const work = runOutfitOnce({ ...deps, signal: stop.signal }); await vi.waitFor(() => expect(deps.provider).toHaveBeenCalledOnce());
    stop.abort(); await work;
    expect(deps.repository.finish.mock.calls[0][1]).toMatchObject({ status: 'interrupted', errorCode: 'WORKER_STOPPED' });
  });
});
