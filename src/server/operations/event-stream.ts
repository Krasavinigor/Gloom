import type { OperationSnapshot } from './schema';
import type { OperationEventHub } from './events';

const terminal = new Set(['succeeded', 'failed', 'timed_out', 'interrupted']);

export function createOperationEventStream(options: {
  ids: readonly string[];
  signal: AbortSignal;
  readSnapshots: (ids: string[]) => Promise<OperationSnapshot[]>;
  hub: OperationEventHub;
  keepaliveMs?: number;
}): ReadableStream<Uint8Array> {
  const ids = [...new Set(options.ids)];
  if (!ids.length || ids.length > 20) throw new Error('Invalid operation event subscription.');
  const allowed = new Set(ids);
  const encoder = new TextEncoder();
  const revisions = new Map<string, number>();
  const completed = new Set<string>();
  const pending = new Set<string>();
  let stopped = false;
  let initialized = false;
  let reading = false;
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let abort = () => {};
  const clean = () => {
    stopped = true;
    unsubscribe();
    clearInterval(timer);
    options.signal.removeEventListener('abort', abort);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => { if (!stopped) { clean(); controller.close(); } };
      const fail = () => { if (!stopped) { clean(); controller.error(new Error('Operation events unavailable.')); } };
      abort = close;
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) { close(); return; }

      const emit = (snapshots: OperationSnapshot[]) => {
        for (const snapshot of snapshots) {
          if (!allowed.has(snapshot.id) || snapshot.statusRevision <= (revisions.get(snapshot.id) ?? -1)) continue;
          revisions.set(snapshot.id, snapshot.statusRevision);
          if (terminal.has(snapshot.status)) completed.add(snapshot.id);
          controller.enqueue(encoder.encode(`event: operation\ndata: ${JSON.stringify(snapshot)}\n\n`));
        }
        if (completed.size === ids.length) close();
      };
      const flush = async () => {
        if (!initialized || reading || stopped) return;
        reading = true;
        try {
          while (pending.size && !stopped) {
            const changed = [...pending]; pending.clear();
            const snapshots = await options.readSnapshots(changed);
            if (!stopped) emit(snapshots);
          }
        } catch { fail(); } finally { reading = false; }
      };
      unsubscribe = options.hub.subscribe({
        onChange(changed) {
          for (const id of changed) if (allowed.has(id)) pending.add(id);
          void flush();
        },
        onUnavailable: fail,
      });
      if (stopped) { unsubscribe(); return; }
      void (async () => {
        try {
          await options.hub.ready();
          if (stopped) return;
          const snapshots = await options.readSnapshots(ids);
          if (stopped) return;
          if (new Set(snapshots.map((snapshot) => snapshot.id)).size !== ids.length) { fail(); return; }
          emit(snapshots);
          initialized = true;
          if (stopped) return;
          timer = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), options.keepaliveMs ?? 15_000);
          void flush();
        } catch { fail(); }
      })();
    },
    cancel() { clean(); },
  });
}
