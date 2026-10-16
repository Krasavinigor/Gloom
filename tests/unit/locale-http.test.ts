import { describe, expect, it } from 'vitest';
import { changeLocale } from '../../src/server/http/locale-handler';
const origin = 'http://127.0.0.1:3000';
const request = (body: unknown, from = origin) => new Request(`${origin}/api/locale`, {
  method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
describe('locale mutation boundary', () => {
  it('stores only supported locales as a site-wide cookie without AI or a database', async () => {
    const response = await changeLocale(request({ locale: 'ru' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { locale: 'ru' } });
    expect(response.headers.get('set-cookie')).toContain('gloom-locale=ru; Path=/');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects unsupported/extra fields and cross-origin commands without setting a cookie', async () => {
    for (const input of [{ locale: 'fr' }, { locale: 'en', prompt: 'ignore' }, {}]) {
      const response = await changeLocale(request(input));
      expect(response.status).toBe(400);
      expect(response.headers.has('set-cookie')).toBe(false);
    }
    expect((await changeLocale(request({ locale: 'ru' }, 'https://other.example'))).status).toBe(403);
  });
});
