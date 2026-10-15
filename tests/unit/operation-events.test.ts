import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgOperationEventHub, type OperationEventHub } from '@/server/operations/events';
import { createOperationEventStream } from '@/server/operations/event-stream';
import type { OperationSnapshot } from '@/server/operations/schema';

const id = 'ca31e2b5-acce-47a4-bb7f-1955e25d656c';
const snapshot = (revision = 1, status = 'running') => ({ id, kind: 'recognition', targetId: id, status, statusRevision: revision, sendState: 'not_sent', settlementState: 'reserved', errorCode: null, createdAt: '2026-10-15T10:00:00.000Z', deadlineAt: '2026-10-15T10:00:30.000Z' }) as OperationSnapshot;
class Connection extends EventEmitter {
  connect = vi.fn(async () => {});
  query = vi.fn(async () => {});
  end = vi.fn(async () => {});
}
const hubs: OperationEventHub[] = [];
afterEach(async () => { await Promise.all(hubs.splice(0).map((hub) => hub.dispose())); vi.useRealTimers(); });
function setup() {
  const clients: Connection[] = [];
  const hub = createPgOperationEventHub({ connectionString: 'postgresql://localhost/test', createClient: () => { const client = new Connection(); clients.push(client); return client; } });
  hubs.push(hub);
  return { hub, clients };
}
const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);

describe('dedicated operation notification connection', () => {
  it('registers handlers before LISTEN and shares a ready connection', async () => {
    const { hub, clients } = setup();
    const received = vi.fn(); hub.subscribe({ onChange: received, onUnavailable: vi.fn() });
    await Promise.all([hub.ready(), hub.ready()]);
    expect(clients).toHaveLength(1);
    expect(clients[0].listenerCount('notification')).toBe(1);
    expect(clients[0].query).toHaveBeenCalledWith('LISTEN wardrobe_ai_operations');
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 2 }) });
    expect(received).toHaveBeenCalledWith([id]);
    for (const payload of ['{}', 'invalid', JSON.stringify({ operationId: id, statusRevision: -1 })]) clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload });
    clients[0].emit('notification', { channel: 'other', payload: JSON.stringify({ operationId: id, statusRevision: 4 }) });
    expect(received).toHaveBeenCalledTimes(1);
  });
  it('marks feeds unavailable when PG disconnects and reconnects on the next feed', async () => {
    const { hub, clients } = setup(); const failed = vi.fn();
    const unsubscribe = hub.subscribe({ onChange: vi.fn(), onUnavailable: failed });
    await hub.ready(); clients[0].emit('error', new Error('Disconnected'));
    expect(failed).toHaveBeenCalledTimes(1);
    unsubscribe(); await hub.ready(); expect(clients).toHaveLength(2);
    await hub.dispose(); expect(clients[1].end).toHaveBeenCalledTimes(1);
    await expect(hub.ready()).rejects.toThrow();
  });
  it('does not leak a client after a failed LISTEN', async () => {
    const client = new Connection(); client.query.mockRejectedValueOnce(new Error('Failed'));
    const hub = createPgOperationEventHub({ connectionString: 'postgresql://localhost/test', createClient: () => client }); hubs.push(hub);
    const failed = vi.fn(); hub.subscribe({ onChange: vi.fn(), onUnavailable: failed });
    await expect(hub.ready()).rejects.toThrow('Failed');
    expect(failed).toHaveBeenCalledTimes(1); expect(client.end).toHaveBeenCalledOnce();
  });
  it('removes watchers before dispatch and never revives a disposed hub', async () => {
    const { hub, clients } = setup(); const changed = vi.fn(); const unavailable = vi.fn();
    const remove = hub.subscribe({ onChange: changed, onUnavailable: unavailable });
    await hub.ready(); remove();
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 2 }) });
    expect(changed).not.toHaveBeenCalled();
    await hub.dispose();
    hub.subscribe({ onChange: changed, onUnavailable: unavailable })();
    expect(unavailable).toHaveBeenCalledOnce(); expect(clients[0].listenerCount('notification')).toBe(0);
  });
});

describe('operation SSE stream', () => {
  it('subscribes before snapshots, buffers racing notifications and ignores stale revisions', async () => {
    const { hub, clients } = setup();
    let resolve!: (value: OperationSnapshot[]) => void;
    const initial = new Promise<OperationSnapshot[]>((done) => { resolve = done; });
    const read = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce([snapshot(2)]).mockResolvedValueOnce([snapshot(1)]).mockResolvedValueOnce([snapshot(3, 'succeeded')]);
    const reader = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: read, hub }).getReader();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 2 }) });
    resolve([snapshot()]);
    expect(decode((await reader.read()).value)).toContain('"statusRevision":1');
    expect(decode((await reader.read()).value)).toContain('"statusRevision":2');
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 1 }) });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 3 }) });
    expect(decode((await reader.read()).value)).toContain('"status":"succeeded"');
    expect((await reader.read()).done).toBe(true);
  });
  it('sends already terminal snapshots then closes without waiting for notifications', async () => {
    const { hub } = setup(); const read = vi.fn().mockResolvedValue([snapshot(2, 'failed')]);
    const reader = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: read, hub }).getReader();
    expect(decode((await reader.read()).value)).toContain('event: operation');
    expect((await reader.read()).done).toBe(true); expect(read).toHaveBeenCalledOnce();
  });
  it('releases watchers on abort and never polls snapshots for keepalive', async () => {
    vi.useFakeTimers(); const { hub } = setup(); const controller = new AbortController();
    const read = vi.fn().mockResolvedValue([snapshot()]);
    const subscribe = vi.spyOn(hub, 'subscribe');
    const reader = createOperationEventStream({ ids: [id], signal: controller.signal, readSnapshots: read, hub, keepaliveMs: 20 }).getReader();
    await reader.read(); await vi.advanceTimersByTimeAsync(20);
    expect(decode((await reader.read()).value)).toBe(': keepalive\n\n');
    expect(read).toHaveBeenCalledOnce(); controller.abort();
    expect((await reader.read()).done).toBe(true); expect(subscribe).toHaveBeenCalledOnce();
  });
  it('errors an active feed on listener failure rather than masking it with keepalive', async () => {
    const { hub, clients } = setup();
    const reader = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: async () => [snapshot()], hub }).getReader();
    await reader.read(); clients[0].emit('end');
    await expect(reader.read()).rejects.toThrow('Operation events unavailable.');
  });
  it('closes immediately for an already aborted request and rejects unbounded subscriptions', async () => {
    const { hub } = setup(); const controller = new AbortController(); controller.abort();
    const read = vi.fn(); const options = { ids: [id], signal: controller.signal, readSnapshots: read, hub };
    expect((await createOperationEventStream(options).getReader().read()).done).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(() => createOperationEventStream({ ...options, ids: [] })).toThrow('Invalid operation');
    expect(() => createOperationEventStream({ ...options, ids: Array.from({ length: 21 }, (_, index) => `${index}`) })).toThrow('Invalid operation');
  });
  it('fails a feed if snapshots disappear and cleans up on reader cancellation', async () => {
    const { hub, clients } = setup();
    const missing = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: async () => [], hub }).getReader();
    await expect(missing.read()).rejects.toThrow('Operation events unavailable.');
    const read = vi.fn().mockResolvedValue([snapshot()]);
    const reader = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: read, hub }).getReader();
    await reader.read(); await reader.cancel();
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 2 }) });
    await Promise.resolve(); expect(read).toHaveBeenCalledOnce();
  });
  it('fails an active feed when a committed notification cannot be read', async () => {
    const { hub, clients } = setup(); const read = vi.fn().mockResolvedValueOnce([snapshot()]).mockRejectedValueOnce(new Error('Database down'));
    const reader = createOperationEventStream({ ids: [id], signal: new AbortController().signal, readSnapshots: read, hub }).getReader();
    await reader.read();
    clients[0].emit('notification', { channel: 'wardrobe_ai_operations', payload: JSON.stringify({ operationId: id, statusRevision: 2 }) });
    await expect(reader.read()).rejects.toThrow('Operation events unavailable.');
  });
});
