// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationEvents } from '@/features/recognition/use-operation-events';

const first = 'ca31e2b5-acce-47a4-bb7f-1955e25d656c';
const second = '1a2ddbbf-934d-4610-a593-67ebdaec7fc2';
const event = (id: string, revision: number, status = 'running') => ({ id, kind: 'recognition', targetId: id, status, statusRevision: revision, sendState: 'not_sent', settlementState: 'reserved', errorCode: null, createdAt: '2026-10-15T10:00:00.000Z', deadlineAt: '2026-10-15T10:00:30.000Z' });
class Source extends EventTarget {
  static instances: Source[] = [];
  close = vi.fn();
  constructor(readonly url: string) { super(); Source.instances.push(this); }
  send(value: unknown) { this.dispatchEvent(new MessageEvent('operation', { data: JSON.stringify(value) })); }
}
beforeEach(() => { Source.instances = []; vi.stubGlobal('EventSource', Source); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('operation feed hook', () => {
  it('uses a single feed, skips older revisions independently per operation and closes on all terminal', () => {
    const changed = vi.fn();
    const { result } = renderHook(() => useOperationEvents([first, second, first], changed));
    expect(Source.instances).toHaveLength(1);
    const source = Source.instances[0];
    expect(source.url).toBe(`/api/operation-events?ids=${[second, first].sort().join(',')}`);
    act(() => source.dispatchEvent(new Event('open')));
    expect(result.current).toBe('open');
    act(() => { source.send(event(first, 3)); source.send(event(first, 2)); source.send(event(second, 1)); source.send(event(first, 3)); });
    expect(changed).toHaveBeenCalledTimes(2);
    act(() => source.send(event(first, 4, 'succeeded')));
    expect(source.close).not.toHaveBeenCalled();
    act(() => source.send(event(second, 2, 'failed')));
    expect(source.close).toHaveBeenCalledOnce(); expect(result.current).toBe('closed');
  });
  it('keeps native read-only reconnect and uses the latest callback without re-opening the feed', () => {
    const earlier = vi.fn(); const latest = vi.fn();
    const { result, rerender } = renderHook(({ onSnapshot }) => useOperationEvents([first], onSnapshot), { initialProps: { onSnapshot: earlier } });
    rerender({ onSnapshot: latest });
    const source = Source.instances[0];
    act(() => source.dispatchEvent(new Event('error')));
    expect(result.current).toBe('reconnecting'); expect(source.close).not.toHaveBeenCalled();
    act(() => { source.dispatchEvent(new Event('open')); source.send(event(first, 1)); });
    expect(latest).toHaveBeenCalledOnce(); expect(earlier).not.toHaveBeenCalled(); expect(Source.instances).toHaveLength(1);
  });
  it('ignores malformed/unrequested snapshots and releases subscriptions on no watchers/unmount', () => {
    const changed = vi.fn(); const { rerender, unmount } = renderHook(({ ids }) => useOperationEvents(ids, changed), { initialProps: { ids: [first] } });
    const source = Source.instances[0];
    act(() => { source.send(event(second, 1)); source.send({ id: first, status: 'bogus' }); source.dispatchEvent(new MessageEvent('operation', { data: 'bad-json' })); });
    expect(changed).not.toHaveBeenCalled();
    rerender({ ids: [] }); expect(source.close).toHaveBeenCalledOnce();
    unmount(); expect(Source.instances).toHaveLength(1);
  });
  it('does not retain StrictMode subscriptions or apply events from old feeds', () => {
    const changed = vi.fn();
    const { unmount } = renderHook(() => useOperationEvents([first], changed), { wrapper: StrictMode });
    expect(Source.instances).toHaveLength(2); expect(Source.instances[0].close).toHaveBeenCalledOnce();
    act(() => { Source.instances[0].send(event(first, 1)); Source.instances[1].send(event(first, 1)); });
    expect(changed).toHaveBeenCalledOnce(); unmount(); expect(Source.instances[1].close).toHaveBeenCalledOnce();
  });
});
