import { ApiError } from './api-error';

type Bucket = 'read' | 'mutation' | 'upload';
type Window = Readonly<{ started: number; count: number }>;

export function localOrigin(request: Request): string {
  const host = request.headers.get('host');
  try {
    if (!host) throw new Error();
    const url = new URL(`http://${host}`);
    if (url.host !== host.toLowerCase() || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new ApiError('forbidden_host', 403, 'Доступ разрешён только через локальный адрес приложения.');
  }
}

export function createRequestGuard(
  clock = Date.now,
  limits: Readonly<Record<Bucket, number>> = { read: 600, mutation: 120, upload: 20 },
) {
  let windows: Readonly<Partial<Record<Bucket, Window>>> = {};
  return (request: Request, bucket: Bucket): void => {
    const origin = localOrigin(request);
    const suppliedOrigin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if ((site && !['same-origin', 'none'].includes(site))
      || (suppliedOrigin && suppliedOrigin !== origin)
      || (!['GET', 'HEAD'].includes(request.method) && suppliedOrigin !== origin)) {
      throw new ApiError('forbidden_origin', 403, 'Запрос должен исходить со страницы этого приложения.');
    }
    const now = clock();
    const previous = windows[bucket];
    const window = previous && now - previous.started < 60_000 ? previous : { started: now, count: 0 };
    if (window.count >= limits[bucket]) throw new ApiError('rate_limited', 429, 'Слишком много запросов. Повторите через минуту.');
    windows = { ...windows, [bucket]: { ...window, count: window.count + 1 } };
  };
}

export const guardRequest = createRequestGuard();
let activeUploads = 0;

export async function withUploadSlot<T>(action: () => Promise<T>): Promise<T> {
  if (activeUploads >= 2) throw new ApiError('rate_limited', 429, 'Сейчас обрабатываются другие фотографии. Повторите позже.');
  activeUploads += 1;
  try { return await action(); } finally { activeUploads -= 1; }
}
