import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectIpLocation } from '@/features/location/ip-location';

const payload = { city: 'Berlin', region: 'Berlin', country_name: 'Germany', country_code: 'DE', latitude: 52.5, longitude: 13.4, timezone: 'Europe/Berlin', ip: 'private', postal: 'discard' };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('approximate browser location', () => {
  it('returns only the validated place and never sends the IP to the application', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await detectIpLocation()).toEqual({ id: 'ip', name: 'Berlin', region: 'Berlin', country: 'Germany', countryCode: 'DE', latitude: 52.5, longitude: 13.4, timezone: 'Europe/Berlin' });
    expect(fetchMock).toHaveBeenCalledWith('https://ipapi.co/json/', expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
  });
  it.each([{ ...payload, latitude: 100 }, { ...payload, timezone: 'not/a/zone' }, { ...payload, error: true }, null])('rejects unusable provider data', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    await expect(detectIpLocation()).rejects.toThrow('Не удалось определить город');
  });
  it('handles provider failures without exposing their response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private provider details', { status: 429 })));
    await expect(detectIpLocation()).rejects.toThrow('Не удалось определить город');
  });
  it('stops an unanswered request after five seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const request = detectIpLocation();
    const assertion = expect(request).rejects.toThrow('Не удалось определить город');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
  it('supports cancellation before contacting the provider', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(detectIpLocation(controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
