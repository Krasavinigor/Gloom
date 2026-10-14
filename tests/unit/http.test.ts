import { describe, expect, it } from 'vitest';
import { ApiError, errorResponse } from '../../src/server/http/errors';
import { createRequestGuard, withUploadSlot } from '../../src/server/http/guard';
import { readBoundedBody, readJson, readPhotoUpload } from '../../src/server/http/body';

function request(method = 'GET', headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:3100/api/garments', {
    method, headers: { host: '127.0.0.1:3100', ...headers },
  });
}

describe('local API boundary', () => {
  it('accepts local same-origin and refuses foreign origins, hosts and fetch sites', () => {
    const guard = createRequestGuard();
    expect(() => guard(request('POST', { origin: 'http://127.0.0.1:3100' }), 'mutation')).not.toThrow();
    const invalidHeaders: Record<string, string>[] = [
      { origin: 'https://evil.test' }, { origin: 'null' }, {},
      { origin: 'http://127.0.0.1:3100', host: 'evil.test:3100' },
      { origin: 'http://127.0.0.1:3100', 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of invalidHeaders) expect(() => guard(request('POST', headers), 'mutation')).toThrow(ApiError);
    expect(() => guard(request('GET', { host: '127.0.0.1.evil.test' }), 'read')).toThrow();
    expect(() => guard(request('GET', { host: 'localhost@evil.test' }), 'read')).toThrow();
    expect(() => guard(request('GET', { 'sec-fetch-site': 'cross-site' }), 'read')).toThrow();
  });

  it('bounds a fixed bucket and starts a new window without trusting forwarded IP', () => {
    let now = 0;
    const guard = createRequestGuard(() => now, { read: 2, mutation: 2, upload: 1 });
    guard(request(), 'read'); guard(request(), 'read');
    expect(() => guard(request('GET', { 'x-forwarded-for': 'different' }), 'read')).toThrow();
    now = 60_000;
    expect(() => guard(request(), 'read')).not.toThrow();
  });

  it('limits concurrent decoding and releases a slot after failure', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const first = withUploadSlot(() => waiting);
    const second = withUploadSlot(() => waiting);
    await expect(withUploadSlot(async () => undefined)).rejects.toMatchObject({ status: 429 });
    finish(); await Promise.all([first, second]);
    await expect(withUploadSlot(async () => { throw new Error('decode'); })).rejects.toThrow('decode');
    await expect(withUploadSlot(async () => 'ready')).resolves.toBe('ready');
  });

  it('does not expose SQL, secret values or internal paths in failures', async () => {
    const response = errorResponse(new Error('postgres://secret@host /private/photo'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/secret|private|postgres/);
    const limited = errorResponse(new ApiError('rate_limited', 429, 'Подождите.'));
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(limited.headers.get('cache-control')).toBe('no-store');
  });
});

describe('bounded request parsing', () => {
  it('cancels a streamed body before accumulating past the limit', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); },
      cancel() { cancelled = true; },
    });
    const input = new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(readBoundedBody(input, 6)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it('rejects a stalled upload and malformed content length', async () => {
    const stream = new ReadableStream<Uint8Array>();
    const input = new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(readBoundedBody(input, 20, 5)).rejects.toMatchObject({ status: 408 });
    await expect(readBoundedBody(request('POST', { 'content-length': 'fake' }), 20)).rejects.toMatchObject({ status: 400 });
    await expect(readBoundedBody(request('POST', { 'content-length': '30' }), 20)).rejects.toMatchObject({ status: 413 });
  });

  it('parses only bounded JSON and returns safe syntax errors', async () => {
    const make = (body: string, type = 'application/json') => new Request('http://localhost', {
      method: 'POST', headers: { 'content-type': type }, body,
    });
    await expect(readJson(make('{"version":1}'))).resolves.toEqual({ version: 1 });
    await expect(readJson(make('broken'))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(make('{}', 'text/plain'))).rejects.toMatchObject({ status: 415 });
  });

  it('accepts a single photo, never uses its filename, and rejects unexpected fields', async () => {
    const form = new FormData();
    form.append('photo', new File(['image'], '../../unsafe.jpg', { type: 'image/jpeg' }));
    const make = () => new Request('http://localhost', { method: 'POST', body: form });
    expect(await readPhotoUpload(make())).toEqual(Buffer.from('image'));
    form.append('path', '/private');
    await expect(readPhotoUpload(make())).rejects.toMatchObject({ status: 400 });
    await expect(readPhotoUpload(request('POST'))).rejects.toMatchObject({ status: 415 });
  });
});
