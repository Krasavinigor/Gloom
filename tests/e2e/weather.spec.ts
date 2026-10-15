import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';
import { createDatabase } from '../../src/server/db/connection';
import { testPlaces } from '../fixtures/providers';

async function resetLocation() {
  const schema = process.env.E2E_MANAGED_SCHEMA ?? '';
  if (!/^wardrobe_e2e_[a-f0-9]{32}$/.test(schema) || process.env.DATABASE_SCHEMA !== schema) {
    throw new Error('Location reset requires the isolated browser-test schema.');
  }
  const database = createDatabase(process.env.DATABASE_URL!, schema);
  try {
    await database('app_state').where({ id: 'local' }).update({ selected_place: null,
      location_source: null, location_version: database.raw('location_version + 1') });
  } finally {
    await database.destroy();
  }
}

async function selectCity(page: Page, city: string) {
  await page.getByLabel('Город', { exact: true }).fill(city);
  await page.getByRole('button', { name: 'Найти город', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^Выбрать ${city},`) }).click();
  await expect(page.getByText('Выбрано вручную', { exact: true })).toBeVisible();
}

test.beforeEach(resetLocation);

test('manual city renders fresh weather, attribution and persists through SSR without repeating IP', async ({ page, request }, info) => {
  let ipRequests = 0;
  page.on('request', (request) => { if (request.url() === 'https://ipapi.co/json/') ipRequests += 1; });
  await page.goto('/outfits');
  await expect(page.getByText('Не удалось определить город. Выберите его вручную.')).toBeVisible();
  await selectCity(page, 'Москва');
  const weather = page.getByRole('region', { name: 'Погода для выбранного места' });
  await expect(weather.getByText('12 °C', { exact: true })).toBeVisible();
  await expect(weather.getByText('Ощущается как 10 °C', { exact: true })).toBeVisible();
  await expect(weather.getByRole('group', { name: 'Осадки и порывы по часовым интервалам' })).toBeVisible();
  await expect(weather.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute('href', 'https://open-meteo.com/');
  await expect(weather.getByText('Устаревшие данные')).toHaveCount(0);
  const html = await request.get('/outfits');
  expect(await html.text()).toContain('Москва, Москва, Россия');
  await page.reload();
  await expect(page.getByText('Москва, Москва, Россия', { exact: true })).toBeVisible();
  await expect(weather.getByText('12 °C', { exact: true })).toBeVisible();
  expect(ipRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('weather-fresh.png'), fullPage: true });
});

test('a pending IP response cannot replace a manually selected city', async ({ page, request }) => {
  let pending: Route | undefined;
  let notifyStarted: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  await page.route('https://ipapi.co/json/', (route) => { pending = route; notifyStarted(); });
  await page.goto('/outfits');
  await started;
  await selectCity(page, 'Берлин');
  await expect(page.getByRole('region', { name: 'Погода для выбранного места' })).toContainText('Europe/Berlin');
  try {
    await pending!.fulfill({ json: { city: 'Москва', region: 'Москва', country_name: 'Россия',
      country_code: 'RU', latitude: testPlaces.moscow.latitude,
      longitude: testPlaces.moscow.longitude, timezone: 'Europe/Moscow' } });
  } catch {
    expect(pending!.request().failure()?.errorText).toContain('ERR_ABORTED');
  }
  const response = await request.get('/api/location');
  expect((await response.json()).data).toMatchObject({ source: 'manual', place: { id: testPlaces.berlin.id } });
  await page.reload();
  await expect(page.getByText('Берлин, Берлин, Германия', { exact: true })).toBeVisible();
});

test('IP and city-search failure leave manual recovery available', async ({ page }) => {
  await page.goto('/outfits');
  await expect(page.getByText('Не удалось определить город. Выберите его вручную.')).toBeVisible();
  await page.getByLabel('Город', { exact: true }).fill('Ошибка');
  await page.getByRole('button', { name: 'Найти город', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Не удалось найти места. Повторите поиск.');
  await selectCity(page, 'Москва');
  await expect(page.getByRole('region', { name: 'Погода для выбранного места' })).toContainText('12 °C');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('provider failure exposes cached stale weather and preserves its fetch time on refresh', async ({ page, request }, info) => {
  await page.goto('/outfits');
  await selectCity(page, 'Таллин');
  const weather = page.getByRole('region', { name: 'Погода для выбранного места' });
  await expect(weather.getByText('Устаревшие данные', { exact: true })).toBeVisible();
  await expect(weather).toContainText('Показан сохранённый прогноз');
  const state = (await (await request.get('/api/location')).json()).data;
  const getWeather = async () => (await (await request.get(`/api/weather?locationVersion=${state.locationVersion}`)).json()).data;
  const previous = await getWeather();
  expect(previous.status).toBe('stale');
  expect(Date.parse(previous.fetchedAt)).toBeLessThan(Date.now() - 15 * 60_000);
  await page.getByRole('button', { name: 'Обновить погоду', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Обновить погоду', exact: true })).toBeEnabled();
  await expect(weather.getByText('Устаревшие данные', { exact: true })).toBeVisible();
  expect((await getWeather()).fetchedAt).toBe(previous.fetchedAt);
  await page.reload();
  await expect(weather.getByText('Устаревшие данные', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('weather-stale.png'), fullPage: true });
});
