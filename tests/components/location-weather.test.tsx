// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, useI18n } from '@/i18n/provider';
import { LocationSearch } from '@/features/location/location-search';
import { WeatherPanel, formatWeatherTime } from '@/features/weather/weather-panel';
import type { WeatherSnapshot } from '@/features/weather/schema';
vi.mock('next/navigation', () => ({ usePathname: () => '/outfits' }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const weather: WeatherSnapshot = {
  status: 'fresh',
  locationVersion: 1,
  placeId: '1',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  period: {
    start: '2026-10-14T10:00:00.000Z',
    end: '2026-10-14T13:00:00.000Z',
    timezone: 'Europe/London',
  },
  current: {
    time: '2026-10-14T10:00:00.000Z',
    intervalSeconds: 900,
    temperature: 12.5,
    apparentTemperature: 10,
    weatherCode: 61,
    isDay: true,
    windSpeed: 10,
    windGusts: 20,
    precipitation: 1,
  },
  summary: null,
  message: null,
};

it('renders English weather and keeps metric units and the selected timezone', () => {
  render(<WeatherPanel weather={weather} now={Date.parse(weather.fetchedAt!)} />);
  expect(screen.getByRole('region', { name: 'Weather for the selected place' })).toBeTruthy();
  expect(screen.getByText('Rain')).toBeTruthy();
  expect(screen.getByText('12.5 °C')).toBeTruthy();
  expect(screen.getByText('Wind 10 km/h · gusts up to 20 km/h')).toBeTruthy();
  expect(formatWeatherTime(weather.period.start, 'Europe/London', 'en')).toContain('11:00');
  expect(formatWeatherTime(weather.period.start, 'Europe/Moscow', 'en')).toContain('13:00');
});

function Switch() {
  const { setLocale } = useI18n();
  return <button onClick={() => void setLocale('ru')}>Switch language</button>;
}
it('preserves query and results on locale switch and submits the result search locale', async () => {
  const user = userEvent.setup();
  const place = {
    id: '1',
    name: 'London',
    region: '',
    country: 'United Kingdom',
    countryCode: 'GB',
    latitude: 51,
    longitude: 0,
    timezone: 'Europe/London',
  };
  const fetcher = vi
    .fn()
    .mockImplementation(async (url: string) =>
      Response.json({ success: true, data: url === '/api/locale' ? { locale: 'ru' } : [place] }),
    );
  vi.stubGlobal('fetch', fetcher);
  const select = vi.fn();
  const query = new QueryClient();
  render(
    <QueryClientProvider client={query}>
      <I18nProvider>
        <Switch />
        <LocationSearch onSelect={select} onManualIntent={() => {}} busy={false} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await user.type(screen.getByRole('textbox', { name: 'City' }), 'London');
  await user.click(screen.getByRole('button', { name: 'Find city' }));
  await screen.findByRole('button', { name: 'Choose London, United Kingdom' });
  expect(fetcher.mock.calls[0][0]).toBe('/api/places?query=London&locale=en');
  await user.click(screen.getByRole('button', { name: 'Switch language' }));
  const result = await screen.findByRole('button', { name: 'Выбрать London, United Kingdom' });
  expect((screen.getByRole('textbox', { name: 'Город' }) as HTMLInputElement).value).toBe('London');
  await user.click(result);
  expect(select).toHaveBeenCalledWith(place, 'London', 'en');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  ['en', 'City', 'Find city', 'City not found. Try another name.'],
  ['ru', 'Город', 'Найти город', 'Город не найден. Попробуйте другое название.'],
] as const)('localizes an empty city search in %s', async (locale, label, button, message) => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: [] })));
  const query = new QueryClient();
  render(
    <QueryClientProvider client={query}>
      <I18nProvider initialLocale={locale}>
        <LocationSearch onSelect={() => {}} onManualIntent={() => {}} busy={false} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await user.type(screen.getByRole('textbox', { name: label }), 'Unknown city');
  await user.click(screen.getByRole('button', { name: button }));
  expect((await screen.findByRole('status')).textContent).toBe(message);
});
