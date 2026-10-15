import { Client, type Notification } from 'pg';
import { z } from 'zod';
import { validateDatabaseUrl } from '../config/environment';

export const OPERATION_EVENTS_CHANNEL = 'wardrobe_ai_operations';
const notificationSchema = z.object({ operationId: z.uuid(), statusRevision: z.number().int().positive() }).strict();
type Watcher = { onChange: (ids: string[]) => void; onUnavailable: () => void };
interface ListenerClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification', listener: (notification: Notification) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  removeAllListeners(): unknown;
}
export interface OperationEventHub {
  ready(): Promise<void>;
  subscribe(watcher: Watcher): () => void;
  dispose(): Promise<void>;
}

/** A dedicated session connection: LISTEN must never borrow a transactional pool client. */
export function createPgOperationEventHub(options: { connectionString: string; createClient?: () => ListenerClient }): OperationEventHub {
  const connectionString = validateDatabaseUrl(options.connectionString);
  const watchers = new Set<Watcher>();
  let client: ListenerClient | null = null;
  let readiness: Promise<void> | null = null;
  let disposed = false;
  const closing = new WeakMap<ListenerClient, Promise<void>>();

  function disconnect(connection: ListenerClient): Promise<void> {
    let ending = closing.get(connection);
    if (!ending) {
      ending = connection.end().catch(() => {}).finally(() => connection.removeAllListeners()).then(() => {});
      closing.set(connection, ending);
    }
    return ending;
  }

  function unavailable(connection: ListenerClient) {
    if (client !== connection) return;
    client = null;
    readiness = null;
    for (const watcher of [...watchers]) watcher.onUnavailable();
    // Keep the error handler attached until end() settles, avoiding an unhandled pg error.
    void disconnect(connection);
  }
  async function connect() {
    const connection: ListenerClient = options.createClient?.() ?? new Client({ connectionString, connectionTimeoutMillis: 5_000, application_name: 'wardrobe_operation_events' });
    client = connection;
    connection.on('notification', (message) => {
      if (client !== connection || message.channel !== OPERATION_EVENTS_CHANNEL || !message.payload) return;
      let payload: unknown;
      try { payload = JSON.parse(message.payload); } catch { return; }
      const parsed = notificationSchema.safeParse(payload);
      if (!parsed.success) return;
      for (const watcher of [...watchers]) watcher.onChange([parsed.data.operationId]);
    });
    connection.on('error', () => unavailable(connection));
    connection.on('end', () => unavailable(connection));
    try {
      await connection.connect();
      if (disposed || client !== connection) throw new Error('Operation events unavailable.');
      // An individual query is an implicit transaction; readiness follows its commit.
      await connection.query(`LISTEN ${OPERATION_EVENTS_CHANNEL}`);
      if (disposed || client !== connection) throw new Error('Operation events unavailable.');
    } catch (error) { unavailable(connection); throw error; }
  }
  return {
    ready() {
      if (disposed) return Promise.reject(new Error('Operation event hub disposed.'));
      readiness ??= connect();
      return readiness;
    },
    subscribe(watcher) {
      if (disposed) { watcher.onUnavailable(); return () => {}; }
      watchers.add(watcher);
      return () => { watchers.delete(watcher); };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const previous = client;
      if (previous) unavailable(previous);
      watchers.clear();
      if (previous) await disconnect(previous);
    },
  };
}
