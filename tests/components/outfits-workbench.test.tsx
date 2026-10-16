// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@/i18n/provider';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OutfitsWorkbench } from '@/features/outfits/outfits-workbench';
import { WeatherPanel, formatWeatherTime } from '@/features/weather/weather-panel';
import type { Place, LocationState } from '@/features/location/schema';
import type { WeatherSnapshot } from '@/features/weather/schema';

const berlin: Place = {
  id: '2950159',
  name: 'Berlin',
  region: 'Berlin',
  country: 'Germany',
  countryCode: 'DE',
  latitude: 52.5,
  longitude: 13.4,
  timezone: 'Europe/Berlin',
};
const moscow: Place = {
  ...berlin,
  id: '524901',
  name: 'Москва',
  region: 'Москва',
  country: 'Россия',
  countryCode: 'RU',
  latitude: 55.75,
  longitude: 37.6,
  timezone: 'Europe/Moscow',
};
const empty: LocationState = { place: null, source: null, locationVersion: 0 };
const saved: LocationState = { place: berlin, source: 'manual', locationVersion: 2 };
const weather: WeatherSnapshot = {
  status: 'fresh',
  locationVersion: 2,
  placeId: berlin.id,
  fetchedAt: '2026-10-14T10:16:00.000Z',
  period: {
    start: '2026-10-14T10:15:00.000Z',
    end: '2026-10-14T13:15:00.000Z',
    timezone: berlin.timezone,
  },
  current: {
    time: '2026-10-14T10:15:00.000Z',
    intervalSeconds: 900,
    temperature: 12,
    apparentTemperature: 10,
    weatherCode: 3,
    isDay: true,
    windSpeed: 8,
    windGusts: 14,
    precipitation: 0,
  },
  summary: {
    temperature: { min: 9, max: 12 },
    apparentTemperature: { min: 7, max: 10 },
    windSpeedMax: 10,
    windGustsMax: 18,
    precipitationMm: 0.4,
    precipitationProbabilityMax: 40,
    precipitationPeriod: { start: '2026-10-14T10:00:00.000Z', end: '2026-10-14T14:00:00.000Z' },
  },
  message: null,
};
const ipPayload = {
  city: 'Berlin',
  region: 'Berlin',
  country_name: 'Germany',
  country_code: 'DE',
  latitude: 52.5,
  longitude: 13.4,
  timezone: 'Europe/Berlin',
  ip: 'discard',
};
const reply = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ success: true, data })));
const fail = (status = 503) =>
  Promise.resolve(
    new Response(JSON.stringify({ success: false, error: { message: 'Попробуйте позже.' } }), {
      status,
    }),
  );
function mount(props: Parameters<typeof OutfitsWorkbench>[0], strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const app = (
    <I18nProvider initialLocale="ru">
      <QueryClientProvider client={client}>
        <OutfitsWorkbench {...props} />
      </QueryClientProvider>
    </I18nProvider>
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return client;
}
beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-14T10:16:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('personal place and weather', () => {
  it('renders saved server data without contacting the IP provider or repeating SSR weather fetches', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: saved, initialWeather: weather });
    expect(screen.getByRole('heading', { name: 'Образы на день' })).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Погода для выбранного места' }).textContent,
    ).toContain('12 °C');
    expect(screen.getByText('Выбрано вручную')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('marks an aged forecast without repeating IP detection or fetching weather automatically', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:16:00.000Z'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: saved, initialWeather: weather });
    expect(screen.queryByText('Устаревшие данные')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(15 * 60_000));
    expect(screen.getByText('Устаревшие данные')).toBeTruthy();
    expect(screen.getByText('Прогноз устарел. Обновите погоду перед выходом.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Обновить погоду' })).toBeTruthy();
  });
  it('hydrates using the server clock, then applies the browser clock locally', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:31:00.000Z'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount({
      initialLocation: saved,
      initialWeather: weather,
      initialNow: Date.parse('2026-10-14T10:16:00.000Z'),
    });
    expect(screen.queryByText('Устаревшие данные')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Устаревшие данные')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('searches and explicitly saves a city, then requests weather for the new version', async () => {
    const user = userEvent.setup();
    const newState = { place: moscow, source: 'manual', locationVersion: 3 };
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/places')) return reply([moscow]);
      if (options?.method === 'PUT') return reply(newState);
      return reply({
        ...weather,
        placeId: moscow.id,
        locationVersion: 3,
        period: { ...weather.period, timezone: moscow.timezone },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: saved, initialWeather: weather });
    await user.type(screen.getByLabelText('Город'), 'Москва');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    await user.click(await screen.findByRole('button', { name: 'Выбрать Москва, Москва, Россия' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/weather?locationVersion=3')).toBe(
        true,
      ),
    );
    const body = JSON.parse(
      fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')![1]!.body as string,
    );
    expect(body).toEqual({
      source: 'manual',
      query: 'Москва',
      placeId: moscow.id,
      expectedVersion: 2,
      searchLocale: 'ru',
    });
    expect(await screen.findByText('Москва, Москва, Россия', { selector: 'p' })).toBeTruthy();
  });
  it('detects an approximate place once in StrictMode and sends no raw IP to the local API', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url.startsWith('https:')) return Promise.resolve(new Response(JSON.stringify(ipPayload)));
      if (options?.method === 'PUT')
        return reply({ ...saved, source: 'ip', place: { ...berlin, id: 'ip' } });
      return reply({ ...weather, placeId: 'ip' });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: empty }, true);
    expect(await screen.findByText('Приблизительно по IP — проверьте город')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('https:'))).toHaveLength(1);
    const body = JSON.parse(
      fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')![1]!.body as string,
    );
    expect(body).not.toHaveProperty('ip');
    expect(body.candidate).not.toHaveProperty('ip');
  });
  it('ignores late IP results after manual search has started', async () => {
    let resolveIp!: (response: Response) => void;
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) =>
      url.startsWith('https:')
        ? new Promise<Response>((resolve) => {
            resolveIp = resolve;
          })
        : reply([moscow]),
    );
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: empty });
    await waitFor(() => expect(resolveIp).toBeTruthy());
    await user.type(screen.getByLabelText('Город'), 'Москва');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    resolveIp(new Response(JSON.stringify(ipPayload)));
    expect(
      await screen.findByRole('button', { name: 'Выбрать Москва, Москва, Россия' }),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        (args) => (args as unknown as [string, RequestInit])[1]?.method === 'PUT',
      ),
    ).toBe(false);
    expect(screen.queryByText('Приблизительно по IP — проверьте город')).toBeNull();
  });
  it('leaves manual search available when IP detection fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network error')));
    mount({ initialLocation: empty });
    expect(
      await screen.findByText('Не удалось определить город. Выберите его вручную.'),
    ).toBeTruthy();
    expect((screen.getByLabelText('Город') as HTMLInputElement).disabled).toBe(false);
  });
  it('retains search input and candidates after a version conflict, and reloads location explicitly', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        if (url.startsWith('/api/places')) return reply([moscow]);
        if (options?.method === 'PUT') return fail(409);
        return reply({ ...saved, locationVersion: 3 });
      }),
    );
    mount({ initialLocation: saved, initialWeather: weather });
    await user.type(screen.getByLabelText('Город'), 'Москва');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    await user.click(await screen.findByRole('button', { name: 'Выбрать Москва, Москва, Россия' }));
    expect(await screen.findByText('Не удалось получить данные. Попробуйте ещё раз.')).toBeTruthy();
    expect((screen.getByLabelText('Город') as HTMLInputElement).value).toBe('Москва');
    await user.click(screen.getByRole('button', { name: 'Загрузить актуальное место' }));
    expect(
      await screen.findByRole('button', { name: 'Выбрать Москва, Москва, Россия' }),
    ).toBeTruthy();
  });
  it('reports empty search results without making a selection', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply([])),
    );
    mount({ initialLocation: saved, initialWeather: weather });
    await user.type(screen.getByLabelText('Город'), 'Unknown');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    expect(await screen.findByText('Город не найден. Попробуйте другое название.')).toBeTruthy();
  });
  it('reports a malformed API result safely and permits retrying the search', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ broken: true })),
    );
    mount({ initialLocation: saved, initialWeather: weather });
    await user.type(screen.getByLabelText('Город'), 'Berlin');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    expect(await screen.findByText('Не удалось получить данные. Попробуйте ещё раз.')).toBeTruthy();
  });
  it('discards a search response after the user has changed the query', async () => {
    const user = userEvent.setup();
    let resolveSearch!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSearch = resolve;
          }),
      ),
    );
    mount({ initialLocation: saved, initialWeather: weather });
    await user.type(screen.getByLabelText('Город'), 'Москва');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    await user.clear(screen.getByLabelText('Город'));
    await user.type(screen.getByLabelText('Город'), 'Berlin');
    resolveSearch(new Response(JSON.stringify({ success: true, data: [moscow] })));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Выбрать Москва, Москва, Россия' })).toBeNull(),
    );
  });
  it('never displays weather from the previous city after a new location is selected', async () => {
    const user = userEvent.setup();
    let resolveOld!: (response: Response) => void;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/places')) return reply([moscow]);
      if (options?.method === 'PUT') return reply({ ...saved, place: moscow, locationVersion: 3 });
      if (url.endsWith('=2'))
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      return reply({
        ...weather,
        placeId: moscow.id,
        locationVersion: 3,
        current: { ...weather.current!, temperature: 20 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: saved });
    await waitFor(() => expect(resolveOld).toBeTruthy());
    await user.type(screen.getByLabelText('Город'), 'Москва');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    await user.click(await screen.findByRole('button', { name: 'Выбрать Москва, Москва, Россия' }));
    expect(await screen.findByText('20 °C')).toBeTruthy();
    resolveOld(new Response(JSON.stringify({ success: true, data: weather })));
    await waitFor(() => expect(screen.queryByText('12 °C')).toBeNull());
    expect(screen.getByText('20 °C')).toBeTruthy();
  });
  it('keeps the old city weather hidden while loading the newly selected city', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        if (url.startsWith('/api/places')) return reply([moscow]);
        if (options?.method === 'PUT')
          return reply({ ...saved, place: moscow, locationVersion: 3 });
        return new Promise<Response>(() => {});
      }),
    );
    mount({ initialLocation: saved, initialWeather: weather });
    await user.type(screen.getByLabelText('Город'), 'Москва');
    await user.click(screen.getByRole('button', { name: 'Найти город' }));
    await user.click(await screen.findByRole('button', { name: 'Выбрать Москва, Москва, Россия' }));
    expect(await screen.findByText('Загружаем погоду…')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Погода для выбранного места' })).toBeNull();
  });
  it('retries a failed weather load on demand', async () => {
    const user = userEvent.setup();
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (healthy ? reply(weather) : fail())),
    );
    mount({ initialLocation: saved });
    expect(await screen.findByText('Не удалось получить данные. Попробуйте ещё раз.')).toBeTruthy();
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Обновить погоду' }));
    expect(await screen.findByText('12 °C')).toBeTruthy();
  });
  it('offers location refresh when the weather request refers to an outdated version', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => (url === '/api/location' ? reply(saved) : fail(409)));
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialLocation: saved });
    await user.click(await screen.findByRole('button', { name: 'Загрузить актуальное место' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/location')).toBe(true),
    );
  });
  it('keeps manual search available if saving the detected city fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('https:')
          ? Promise.resolve(new Response(JSON.stringify(ipPayload)))
          : fail(),
      ),
    );
    mount({ initialLocation: empty });
    expect(
      await screen.findByText('Не удалось определить город. Выберите его вручную.'),
    ).toBeTruthy();
    expect(screen.queryByText('Приблизительно по IP — проверьте город')).toBeNull();
  });
  it('refreshes failed SSR location loading without auto-detecting a saved place', async () => {
    const user = userEvent.setup();
    let healthy = false;
    const fetchMock = vi.fn((url: string) =>
      healthy ? reply(url === '/api/location' ? saved : weather) : fail(),
    );
    vi.stubGlobal('fetch', fetchMock);
    mount({ initialError: 'Место недоступно.' });
    expect(await screen.findByText('Не удалось получить данные. Попробуйте ещё раз.')).toBeTruthy();
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку места' }));
    expect(await screen.findByText('Выбрано вручную')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('https:'))).toBe(false);
  });
});

describe('weather display', () => {
  it.each([
    [0, 'Ясно'],
    [61, 'Дождь'],
    [73, 'Снег'],
    [999, 'Погодные условия не уточнены'],
  ])('describes current conditions safely for code %s', (code, description) => {
    render(
      <I18nProvider initialLocale="ru">
        <WeatherPanel
          weather={{ ...weather, current: { ...weather.current!, weatherCode: code } }}
          now={Date.now()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(description)).toBeTruthy();
  });
  it('distinguishes retrieval time, current conditions and the hourly precipitation period', () => {
    render(
      <I18nProvider initialLocale="ru">
        <WeatherPanel weather={weather} now={Date.now()} />
      </I18nProvider>,
    );
    expect(screen.getByText(/Текущие условия на/).textContent).toContain('12:15');
    expect(screen.getByText(/Получено/).textContent).toContain('12:16');
    expect(screen.getByText(/Осадки и порывы по часовым интервалам/).textContent).toContain(
      '12:00',
    );
    expect(screen.getByText(/Осадки и порывы по часовым интервалам/).textContent).toContain(
      '16:00',
    );
    const hourly = screen.getByRole('group', { name: 'Осадки и порывы по часовым интервалам' });
    expect(within(hourly).getByText(/Порывы до 18 км\/ч/)).toBeTruthy();
    expect(within(hourly).getByText(/0,4 мм/)).toBeTruthy();
    expect(screen.getByText('Ориентировочная оценка по почасовому прогнозу.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open-Meteo' }).getAttribute('href')).toBe(
      'https://open-meteo.com/',
    );
  });
  it('marks stale data explicitly and never substitutes it for fresh conditions', () => {
    render(
      <I18nProvider initialLocale="ru">
        <WeatherPanel
          weather={{
            ...weather,
            status: 'stale',
            message: 'Сервис недоступен. Показаны старые данные.',
          }}
          now={Date.now()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Устаревшие данные')).toBeTruthy();
    expect(
      screen.getByText(
        'Не удалось обновить погоду. Показан сохранённый прогноз; подбор пока недоступен.',
      ),
    ).toBeTruthy();
  });
  it('shows unavailability without inventing temperatures', () => {
    render(
      <I18nProvider initialLocale="ru">
        <WeatherPanel
          weather={{
            ...weather,
            status: 'unavailable',
            current: null,
            summary: null,
            fetchedAt: null,
            message: 'Прогноз недоступен.',
          }}
          now={Date.now()}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText('Не удалось получить погоду. Попробуйте обновить её позже.'),
    ).toBeTruthy();
    expect(screen.queryByText('12 °C')).toBeNull();
  });
  it('marks an ended weather period stale even when retrieval happened recently', () => {
    render(
      <I18nProvider initialLocale="ru">
        <WeatherPanel
          weather={{ ...weather, period: { ...weather.period, end: '2026-10-14T10:16:00.000Z' } }}
          now={Date.now()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Устаревшие данные')).toBeTruthy();
  });
  it('formats repeated DST times with distinct UTC offsets', () => {
    const first = formatWeatherTime('2026-10-25T00:30:00.000Z', 'Europe/Berlin');
    const second = formatWeatherTime('2026-10-25T01:30:00.000Z', 'Europe/Berlin');
    expect(first).toContain('02:30');
    expect(second).toContain('02:30');
    expect(first).not.toBe(second);
  });
});
