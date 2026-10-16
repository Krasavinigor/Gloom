// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OutfitPanel } from '@/features/outfits/outfit-panel';
import { I18nProvider, useI18n } from '@/i18n/provider';
import type { OutfitState } from '@/server/outfits/repository';

vi.mock('@/features/recognition/use-operation-events', () => ({
  useOperationEvents: () => 'open',
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function SwitchLocale() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale('ru')}>Switch to Russian</button>;
}
const state: OutfitState = {
  result: null,
  revision: 0,
  activeOperationId: null,
  stale: false,
  staleReasons: [],
  unavailableGarmentIds: [],
};
it('defaults to English without a provider or provider request', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <OutfitPanel initialResult={state} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('heading', { name: 'Outfits from your wardrobe' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open wardrobe' })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
it('changes labels while retaining an in-flight operation and dispatch identity', async () => {
  const user = userEvent.setup();
  const operation = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'queued',
    statusRevision: 1,
  };
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data:
            url === '/api/locale'
              ? { locale: 'ru' }
              : url === '/api/ai-budget'
                ? {
                    month: '2026-10',
                    remainingMicroUsd: 1000000,
                    confirmedCostMicroUsd: 0,
                    limitMicroUsd: 10000000,
                    activeReservedMicroUsd: 0,
                    unknownReservedMicroUsd: 0,
                    warning: false,
                  }
                : operation,
        }),
      ),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = (locale: 'en' | 'ru') => (
    <I18nProvider initialLocale={locale}>
      <QueryClientProvider client={client}>
        <SwitchLocale />
        <OutfitPanel initialResult={state} aiEnabled />
      </QueryClientProvider>
    </I18nProvider>
  );
  render(app('en'));
  await screen.findByText(/Budget/);
  await user.click(screen.getByRole('button', { name: 'Select outfits' }));
  await screen.findByText('Waiting to select outfits…');
  await user.click(screen.getByRole('button', { name: 'Switch to Russian' }));
  await screen.findByText('Ожидаем подбор образов…');
  expect(screen.getByText('Ожидаем подбор образов…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Подбор выполняется' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(fetch.mock.calls.filter(([url]) => url === '/api/outfit-selections')).toHaveLength(1);
});
