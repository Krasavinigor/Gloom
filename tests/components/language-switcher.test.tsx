// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/i18n/provider';
import { LanguageSwitcher } from '@/i18n/language-switcher';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('persists the selected language before updating the UI and document', async () => {
  let acknowledge!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        acknowledge = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <I18nProvider>
      <LanguageSwitcher />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } });
  expect(screen.getByRole('combobox')).toHaveProperty('disabled', true);
  expect(document.documentElement.lang).toBe('en');
  acknowledge(new Response(JSON.stringify({ success: true, data: { locale: 'ru' } })));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Язык' })).toHaveProperty('value', 'ru'),
  );
  expect(document.documentElement.lang).toBe('ru');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/locale',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ locale: 'ru' }) }),
  );
});

it.each(['network', 'invalid-json', 'wrong-locale', 'server-error'])(
  'keeps the current language and reports a %s failure',
  async (failure) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (failure === 'network') throw new Error('Network');
        if (failure === 'invalid-json') return new Response('oops');
        return new Response(JSON.stringify({ success: true, data: { locale: 'en' } }), {
          status: failure === 'server-error' ? 500 : 200,
        });
      }),
    );
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ru' } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveProperty('value', 'en');
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', false);
    expect(document.documentElement.lang).toBe('en');
  },
);
