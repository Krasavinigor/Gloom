import { ApiError } from './errors';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export async function readBoundedBody(request: Request, limit: number, timeout = 15_000): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void request.body?.cancel().catch(() => undefined);
    if (!/^\d+$/.test(length)) throw new ApiError('invalid_body', 400, 'Неверный размер запроса.');
    throw new ApiError('too_large', 413, 'Файл слишком большой. Максимум — 10 МБ.');
  }
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('upload_timeout', 408, 'Загрузка заняла слишком много времени. Повторите попытку.')), timeout);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ApiError('too_large', 413, 'Файл слишком большой. Максимум — 10 МБ.');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    // Cancelling an already closed/aborted request may fail; it cannot affect persisted data.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new ApiError('unsupported_media', 415, 'Ожидается запрос в формате JSON.');
  }
  const body = await readBoundedBody(request, 16 * 1024);
  try { return JSON.parse(body.toString('utf8')) as unknown; }
  catch { throw new ApiError('invalid_json', 400, 'Не удалось прочитать данные карточки.'); }
}

export async function readPhotoUpload(request: Request): Promise<Buffer> {
  const type = request.headers.get('content-type');
  if (!type?.startsWith('multipart/form-data;')) throw new ApiError('unsupported_media', 415, 'Ожидается фотография в форме загрузки.');
  // Bound the incoming stream BEFORE formData buffers/parses it; reserve only 64 KiB for multipart framing.
  const body = await readBoundedBody(request, MAX_PHOTO_BYTES + 64 * 1024);
  let form: FormData;
  try { form = await new Response(new Uint8Array(body), { headers: { 'content-type': type } }).formData(); }
  catch { throw new ApiError('invalid_upload', 400, 'Не удалось прочитать фотографию.'); }
  const entries = [...form.entries()];
  const file = form.get('photo');
  if (entries.length !== 1 || entries[0][0] !== 'photo' || !(file instanceof File) || !file.size) {
    throw new ApiError('invalid_upload', 400, 'Загрузите одну фотографию одной вещи.');
  }
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError('too_large', 413, 'Файл слишком большой. Максимум — 10 МБ.');
  return Buffer.from(await file.arrayBuffer());
}
