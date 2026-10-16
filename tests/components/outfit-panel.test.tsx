// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider, useI18n } from '@/i18n/provider';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OutfitPanel } from '@/features/outfits/outfit-panel';
import type { WeatherSnapshot } from '@/features/weather/schema';
import type { OutfitState } from '@/server/outfits/repository';
import type { OperationSnapshot } from '@/server/operations/schema';

const events = vi.hoisted(() => ({
  callback: undefined as ((value: OperationSnapshot) => void) | undefined,
  ids: [] as string[],
  state: 'open',
}));
vi.mock('@/features/recognition/use-operation-events', () => ({
  useOperationEvents: (ids: string[], callback: (value: OperationSnapshot) => void) => {
    events.ids = ids;
    events.callback = callback;
    return events.state;
  },
}));
const empty: OutfitState = {
  result: null,
  revision: 0,
  activeOperationId: null,
  stale: false,
  staleReasons: [],
  unavailableGarmentIds: [],
};
const garment = {
  id: 'top',
  photoId: 'photo',
  version: 1,
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
  fields: {
    name: 'Футболка',
    type: 't_shirt' as const,
    bodyAreas: ['torso' as const],
    seasons: ['summer' as const],
    layers: ['base' as const],
    color: '',
    pattern: '',
    warmth: 'light' as const,
    temperature: null,
    rainProtection: 'unknown' as const,
    windProtection: 'unknown' as const,
  },
};
const ready: OutfitState = {
  ...empty,
  revision: 1,
  result: {
    backgroundPresetId: 'rain',
    createdAt: '2026-10-16T10:00:00.000Z',
    outfits: [
      {
        id: 'outfit-1',
        title: 'Прогулка',
        explanation: 'Съёмный слой для переменчивой погоды.',
        items: [{ garmentId: garment.id, role: 'base_top' }],
        conditional: true,
        warnings: [{ code: 'RAIN_PROTECTION', message: 'Защита от дождя не подтверждена.' }],
      },
    ],
    snapshot: {
      wardrobeVersion: 1,
      locationVersion: 1,
      place: {
        id: 'city',
        name: 'Москва',
        region: 'Москва',
        country: 'Россия',
        countryCode: 'RU',
        latitude: 55.75,
        longitude: 37.6,
        timezone: 'Europe/Moscow',
      },
      garments: [garment],
      weather: {
        status: 'fresh',
        locationVersion: 1,
        placeId: 'city',
        fetchedAt: '2026-10-16T10:00:00.000Z',
        period: {
          start: '2026-10-16T10:00:00.000Z',
          end: '2026-10-16T13:00:00.000Z',
          timezone: 'Europe/Moscow',
        },
        current: null,
        summary: null,
        message: null,
      },
    },
  },
};
const operation: OperationSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  targetId: '22222222-2222-4222-8222-222222222222',
  kind: 'outfits',
  status: 'queued',
  statusRevision: 1,
  sendState: 'not_sent',
  settlementState: 'reserved',
  createdAt: '2026-10-16T10:00:00.000Z',
  deadlineAt: '2026-10-16T10:00:30.000Z',
  errorCode: null,
};
const budget = {
  month: '2026-10',
  limitMicroUsd: 10_000_000,
  confirmedCostMicroUsd: 0,
  activeReservedMicroUsd: 0,
  unknownReservedMicroUsd: 0,
  remainingMicroUsd: 10_000_000,
  warning: false,
};
const reply = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ success: true, data })));
function mount(
  initialResult: OutfitState = empty,
  aiEnabled = true,
  options?: { now?: number; contextWeather?: WeatherSnapshot },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <I18nProvider initialLocale="ru">
      <QueryClientProvider client={client}>
        <OutfitPanel initialResult={initialResult} aiEnabled={aiEnabled} {...options} />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  events.state = 'open';
  events.callback = undefined;
  events.ids = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) =>
      reply(url === '/api/ai-budget' ? budget : options?.method === 'POST' ? operation : empty),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('personal outfit selection', () => {
  it('dispatches only by explicit button and prevents duplicate requests', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    const button = screen.getByRole('button', { name: 'Подобрать образы' });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0);
    await user.dblClick(button);
    await screen.findByText('Ожидаем подбор образов…');
    const calls = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('/api/outfit-selections');
    expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/);
    expect(client.getQueryData(['outfit-result'])).toMatchObject({
      activeOperationId: operation.id,
    });
  });
  it('restores an existing operation and reloads the result once after terminal SSE', async () => {
    mount({ ...empty, activeOperationId: operation.id });
    expect(events.ids).toEqual([operation.id]);
    act(() => events.callback?.({ ...operation, status: 'running', statusRevision: 2 }));
    expect(screen.getByText('Подбираем образы…')).toBeTruthy();
    act(() => {
      events.callback?.({ ...operation, status: 'succeeded', statusRevision: 3 });
      events.callback?.({ ...operation, status: 'succeeded', statusRevision: 3 });
    });
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/outfit-result'),
      ).toHaveLength(1),
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0);
  });
  it('retains an ambiguous launch key for an explicit check and never automatically retries', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        if (url === '/api/ai-budget') return reply(budget);
        if (options?.method === 'POST' && ++attempts === 1)
          return Promise.reject(new Error('offline'));
        return reply(operation);
      }),
    );
    mount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Подобрать образы' })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
    await screen.findByText(/Связь прервалась/);
    expect(attempts).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Проверить запуск подбора' }));
    await screen.findByText('Ожидаем подбор образов…');
    const keys = vi
      .mocked(fetch)
      .mock.calls.filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it('keeps manual wardrobe and demo links available when AI is disabled', () => {
    mount(empty, false);
    expect(screen.queryByRole('button', { name: 'Подобрать образы' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Открыть гардероб' }).getAttribute('href')).toBe(
      '/wardrobe',
    );
    expect(screen.getByRole('link', { name: 'Посмотреть демо' }).getAttribute('href')).toBe(
      '/demo',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shows conditional warnings and the persisted background for a current result', () => {
    mount(ready, false);
    expect(screen.getByText('Условно подходящий образ')).toBeTruthy();
    expect(screen.getByText('Защита от дождя не подтверждена.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Футболка' }).getAttribute('src')).toBe(
      '/api/assets/photo',
    );
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/rain.svg',
    );
  });
  it('uses a neutral background and hides deleted photos and replacement for a stale result', () => {
    mount(
      {
        ...ready,
        stale: true,
        staleReasons: ['Гардероб изменился.'],
        unavailableGarmentIds: ['top'],
      },
      false,
    );
    expect(screen.getByText('Гардероб изменился.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Футболка' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Заменить:/ })).toBeNull();
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/default.svg',
    );
  });
  it('replaces an item using the alternatives revision without any AI request', async () => {
    const user = userEvent.setup();
    const candidate = {
      ...garment,
      id: 'replacement',
      fields: { ...garment.fields, name: 'Синяя футболка' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) =>
        reply(
          options?.method === 'PATCH'
            ? { ...ready, revision: 2 }
            : url.includes('/alternatives')
              ? { revision: 1, candidates: [candidate] }
              : ready,
        ),
      ),
    );
    mount(ready, false);
    await user.click(screen.getByRole('button', { name: 'Заменить: Основной верх' }));
    await user.selectOptions(await screen.findByLabelText('Замена: Основной верх'), 'replacement');
    await user.click(screen.getByRole('button', { name: 'Применить замену' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Применить замену' })).toBeNull(),
    );
    const calls = vi.mocked(fetch).mock.calls;
    const change = calls.find(([, options]) => options?.method === 'PATCH');
    expect(change?.[0]).toBe('/api/outfit-result/outfit-1/slots/base_top');
    expect(JSON.parse(change?.[1]?.body as string)).toEqual({
      garmentId: 'replacement',
      expectedRevision: 1,
    });
    expect(calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('handles a replacement revision conflict without retrying or losing the existing outfit', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) =>
        options?.method === 'PATCH'
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  success: false,
                  error: { code: 'OUTFITS_STALE', message: 'Образы изменились.' },
                }),
                { status: 409 },
              ),
            )
          : reply(
              url.includes('/alternatives')
                ? { revision: 1, candidates: [{ ...garment, id: 'replacement' }] }
                : ready,
            ),
      ),
    );
    mount(ready, false);
    await user.click(screen.getByRole('button', { name: 'Заменить: Основной верх' }));
    await user.selectOptions(await screen.findByLabelText('Замена: Основной верх'), 'replacement');
    await user.click(screen.getByRole('button', { name: 'Применить замену' }));
    expect(
      await screen.findByText('Исходные данные изменились. Запустите новый подбор.'),
    ).toBeTruthy();
    expect(screen.getByText('Прогулка')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Применить замену' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'PATCH'),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Загрузить актуальные варианты' }));
    await waitFor(() =>
      expect(screen.queryByText('Исходные данные изменились. Запустите новый подбор.')).toBeNull(),
    );
    expect(screen.getByLabelText('Замена: Основной верх')).toHaveProperty('value', '');
  });
  it('preserves the previous successful result and background when a new operation fails', async () => {
    mount({ ...ready, activeOperationId: operation.id }, false);
    act(() =>
      events.callback?.({
        ...operation,
        status: 'failed',
        statusRevision: 2,
        settlementState: 'unknown',
      }),
    );
    expect(screen.getByText(/Результат оплаты неизвестен/)).toBeTruthy();
    expect(screen.getByText('Прогулка')).toBeTruthy();
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/rain.svg',
    );
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/outfit-result'),
      ).toHaveLength(1),
    );
  });
  it('blocks a paid launch on exhausted budget while keeping replacement available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ ...budget, remainingMicroUsd: 0 })),
    );
    mount(ready);
    expect(await screen.findByText(/Бюджет AI исчерпан/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Подобрать образы' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Заменить: Основной верх' })).toBeTruthy();
  });
  it('retries a budget check without dispatching a selection', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(() => reply({ ...budget, warning: true })),
    );
    mount();
    expect(await screen.findByText('Не удалось проверить бюджет AI.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Подобрать образы' })).toHaveProperty(
      'disabled',
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Проверить бюджет' }));
    expect(await screen.findByText(/не менее \$8/)).toBeTruthy();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0);
  });
  it('explains an empty replacement list without offering an invalid choice', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ revision: 1, candidates: [] })),
    );
    mount(ready, false);
    await user.click(screen.getByRole('button', { name: 'Заменить: Основной верх' }));
    expect(await screen.findByText('Подходящих вещей для замены нет.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Применить замену' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Закрыть замену' }));
    expect(screen.queryByText('Подходящих вещей для замены нет.')).toBeNull();
  });
  it.each(['timed_out', 'interrupted'] as const)('explains %s without a paid replay', (status) => {
    events.state = 'reconnecting';
    mount({ ...empty, activeOperationId: operation.id }, false);
    expect(screen.getByText(/Восстанавливаем связь со статусом/)).toBeTruthy();
    act(() => events.callback?.({ ...operation, status, statusRevision: 2 }));
    expect(
      screen.getByText(
        status === 'timed_out' ? 'Время ожидания подбора истекло.' : 'Подбор прервался.',
      ),
    ).toBeTruthy();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0);
  });
  it('explains a launch rejection without retrying a paid request', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/ai-budget'
          ? reply(budget)
          : Promise.resolve(new Response('unavailable', { status: 503 })),
      ),
    );
    mount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Подобрать образы' })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
    expect(
      await screen.findByText('Не удалось выполнить действие. Попробуйте позже.'),
    ).toBeTruthy();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1);
  });
  it('neutralizes an aged forecast locally without polling or a new paid selection', () => {
    const contextWeather = ready.result!.snapshot.weather;
    const view = mount(ready, false, {
      now: Date.parse('2026-10-16T10:14:00.000Z'),
      contextWeather,
    });
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/rain.svg',
    );
    view.rerender(
      <I18nProvider initialLocale="ru">
        <QueryClientProvider client={view.client}>
          <OutfitPanel
            initialResult={ready}
            aiEnabled={false}
            now={Date.parse('2026-10-16T10:15:00.000Z')}
            contextWeather={contextWeather}
          />
        </QueryClientProvider>
      </I18nProvider>,
    );
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/default.svg',
    );
    expect(screen.queryByRole('button', { name: /Заменить:/ })).toBeNull();
    expect(screen.getByText('Обновите погоду перед подбором образов.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses fresh revalidated weather rather than aging the older result snapshot', () => {
    mount(ready, false, {
      now: Date.parse('2026-10-16T10:30:00.000Z'),
      contextWeather: { ...ready.result!.snapshot.weather, fetchedAt: '2026-10-16T10:25:00.000Z' },
    });
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/rain.svg',
    );
    expect(screen.getByRole('button', { name: 'Заменить: Основной верх' })).toBeTruthy();
  });
  it('blocks new selection until unavailable weather is refreshed', async () => {
    mount(ready, true, {
      now: Date.parse('2026-10-16T10:00:00.000Z'),
      contextWeather: { ...ready.result!.snapshot.weather, status: 'unavailable' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Подобрать образы' })).toHaveProperty(
        'disabled',
        true,
      ),
    );
    expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
      '/weather-backgrounds/default.svg',
    );
  });
});

function ChangeLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale('en')}>Switch to English</button>;
}
it('translates display labels and warnings while preserving stored AI text and the background', () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <OutfitPanel initialResult={ready} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Прогулка')).toBeTruthy();
  expect(screen.getByText('Съёмный слой для переменчивой погоды.')).toBeTruthy();
  expect(screen.getByText('Conditionally suitable outfit')).toBeTruthy();
  expect(screen.getByText('Rain protection is not confirmed.')).toBeTruthy();
  expect(screen.getByText('Base top')).toBeTruthy();
  expect(document.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toBe(
    '/weather-backgrounds/rain.svg',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('retains the open replacement and selected item when switching languages', async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      reply(
        url === '/api/locale'
          ? { locale: 'en' }
          : { revision: 1, candidates: [{ ...garment, id: 'replacement' }] },
      ),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nProvider initialLocale="ru">
      <QueryClientProvider client={client}>
        <ChangeLanguage />
        <OutfitPanel initialResult={ready} />
      </QueryClientProvider>
    </I18nProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Заменить: Основной верх' }));
  await user.selectOptions(await screen.findByLabelText('Замена: Основной верх'), 'replacement');
  await user.click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(await screen.findByLabelText('Replacement: Base top')).toHaveProperty(
    'value',
    'replacement',
  );
  expect(screen.getByText('Прогулка')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Apply replacement' })).toHaveProperty(
    'disabled',
    false,
  );
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/alternatives')),
  ).toHaveLength(1);
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/outfit-selections'),
  ).toHaveLength(0);
});
it('localizes app-authored replacement explanations while retaining other AI text', async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => reply({ locale: 'en' })),
  );
  const client = new QueryClient();
  const result: OutfitState = {
    ...ready,
    result: {
      ...ready.result!,
      outfits: [
        ready.result!.outfits[0],
        {
          ...ready.result!.outfits[0],
          id: 'replaced',
          title: 'Сохранённое название',
          explanation: 'Вещь заменена. Комплект повторно проверен по погоде и составу.',
          explanationSource: 'replacement',
        },
      ],
    },
  };
  render(
    <I18nProvider initialLocale="ru">
      <QueryClientProvider client={client}>
        <ChangeLanguage />
        <OutfitPanel initialResult={result} />
      </QueryClientProvider>
    </I18nProvider>,
  );
  expect(
    screen.getByText('Вещь заменена. Комплект повторно проверен по погоде и составу.'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(
    await screen.findByText(
      'Item replaced. The outfit has been checked again for the weather and completeness.',
    ),
  ).toBeTruthy();
  expect(
    screen.queryByText('Вещь заменена. Комплект повторно проверен по погоде и составу.'),
  ).toBeNull();
  expect(screen.getByText('Съёмный слой для переменчивой погоды.')).toBeTruthy();
  expect(screen.getByText('Сохранённое название')).toBeTruthy();
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/outfit-selections'),
  ).toHaveLength(0);
});
