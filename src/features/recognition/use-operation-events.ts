'use client';

import { useEffect, useRef, useState } from 'react';
import { operationSnapshotSchema, type OperationSnapshot } from '@/server/operations/schema';

export type OperationConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';
const terminal = new Set(['succeeded', 'failed', 'timed_out', 'interrupted']);

/** Native reconnect only restores read-only snapshots; it never dispatches an AI request. */
export function useOperationEvents(ids: readonly string[], onSnapshot: (snapshot: OperationSnapshot) => void): OperationConnectionState {
  const key = [...new Set(ids)].sort().join(',');
  const callback = useRef(onSnapshot);
  const [connection, setConnection] = useState<{ key: string; state: OperationConnectionState } | null>(null);
  useEffect(() => { callback.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => {
    if (!key) return;
    const allowed = new Set(key.split(','));
    const revisions = new Map<string, number>();
    const completed = new Set<string>();
    const source = new EventSource(`/api/operation-events?ids=${key}`);
    let stopped = false;
    const update = (state: OperationConnectionState) => { if (!stopped) setConnection({ key, state }); };
    const onOpen = () => update('open');
    const onError = () => update('reconnecting');
    const onOperation = (event: MessageEvent<string>) => {
      if (stopped) return;
      let value: unknown;
      try { value = JSON.parse(event.data); } catch { return; }
      const parsed = operationSnapshotSchema.safeParse(value);
      if (!parsed.success || !allowed.has(parsed.data.id)) return;
      const snapshot = parsed.data;
      if (snapshot.statusRevision <= (revisions.get(snapshot.id) ?? -1)) return;
      revisions.set(snapshot.id, snapshot.statusRevision);
      if (terminal.has(snapshot.status)) completed.add(snapshot.id);
      callback.current(snapshot);
      if (completed.size === allowed.size) {
        update('closed'); stopped = true; source.close();
      }
    };
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);
    source.addEventListener('operation', onOperation as EventListener);
    return () => {
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      source.removeEventListener('operation', onOperation as EventListener);
      if (!stopped) { stopped = true; source.close(); }
    };
  }, [key]);
  if (!key) return 'closed';
  return connection?.key === key ? connection.state : 'connecting';
}
