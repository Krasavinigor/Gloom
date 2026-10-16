import sharp from 'sharp';
import { expect, test } from './fixtures';

async function photo() {
  return { name: 'language-test.jpg', mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 700, height: 900, channels: 3, background: '#62826c' } }).jpeg().toBuffer() };
}

test('English is the server-rendered default and invalid cookies fall back to English', async ({ page, context }) => {
  await context.clearCookies();
  await context.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });
  const response = await page.request.get('/demo/wardrobe');
  const html = await response.text();
  expect(html).toContain('<html lang="en"');
  expect(html).toContain('Demo wardrobe');
  expect(html).toContain('Cream T-shirt');
  await page.goto('/demo/wardrobe');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Demo wardrobe', exact: true })).toBeVisible();
  await context.addCookies([{ name: 'gloom-locale', value: 'fr', domain: '127.0.0.1', path: '/' }]);
  expect(await (await page.request.get('/demo')).text()).toContain('<html lang="en"');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
});

test('switching demo language preserves selected outfits and persists for SSR without provider calls', async ({ page, context }) => {
  await context.clearCookies();
  const providerRequests: string[] = [];
  const localeRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (/\/api\/(?:location|weather|garment-drafts|outfit-selections|operation-events)/.test(url.pathname)
      || !['127.0.0.1', 'localhost'].includes(url.hostname)) providerRequests.push(url.pathname);
    if (url.pathname === '/api/locale') localeRequests.push(request.method());
  });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Find outfits', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A light day', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Лёгкий день', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Язык', exact: true })).toHaveValue('ru');
  await context.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  expect(await (await page.request.get('/demo/wardrobe')).text()).toContain('<html lang="ru"');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('button', { name: 'Подобрать образы', exact: true })).toBeVisible();
  expect(localeRequests).toEqual(['POST']);
  expect(providerRequests).toEqual([]);
});

test('language switches retain a selected photo and unsaved manual form values', async ({ page, context }) => {
  await context.clearCookies();
  const paidRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/(recognition|outfit-selections)$/.test(new URL(request.url()).pathname)) paidRequests.push(request.url());
  });
  await page.goto('/wardrobe');
  await page.getByLabel('Item photo', { exact: true }).setInputFiles(await photo());
  await expect(page.getByAltText('Selected photo preview', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await expect(page.getByAltText('Предпросмотр выбранной фотографии', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить фото', exact: true }).click();
  await expect(page).toHaveURL(/draft=/);
  const draftUrl = page.url();
  const name = 'Моя футболка / My T-shirt';
  await page.getByLabel('Название вещи', { exact: true }).fill(name);
  await page.getByRole('checkbox', { name: 'Лето', exact: true }).check();
  await page.getByRole('combobox', { name: 'Язык', exact: true }).selectOption('en');
  await expect(page.getByLabel('Item name', { exact: true })).toHaveValue(name);
  await expect(page.getByRole('checkbox', { name: 'Summer', exact: true })).toBeChecked();
  expect(page.url()).toBe(draftUrl);
  expect(paidRequests).toEqual([]);
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(page.getByLabel('Item photo', { exact: true })).toBeVisible();
});

test('an English recognition keeps its captured output language through switching and reload', async ({ page, context }) => {
  await context.clearCookies();
  const starts: string[] = [];
  page.on('request', request => {
    if (/\/recognition$/.test(request.url()) && request.method() === 'POST') starts.push(request.url());
  });
  await page.goto('/wardrobe');
  await page.getByLabel('Item photo', { exact: true }).setInputFiles(await photo());
  await page.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await expect(page).toHaveURL(/draft=/);
  const draftId = new URL(page.url()).searchParams.get('draft')!;
  await page.getByRole('button', { name: 'Recognize clothing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recognition in progress', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  const manualName = 'Ручное описание остаётся моим';
  await page.getByLabel('Название вещи', { exact: true }).fill(manualName);
  await expect(page.getByText('Распознавание завершено. Проверьте описание.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Название вещи', { exact: true })).toHaveValue(manualName);
  const draft = await (await page.request.get(`/api/garment-drafts/${draftId}`)).json();
  expect(draft.data.aiProposal).toMatchObject({ outputLocale: 'en', fields: { name: 'Green AI T-shirt' } });
  expect(starts).toHaveLength(1);
  await page.getByRole('button', { name: 'Применить AI-описание к форме', exact: true }).click();
  await expect(page.getByLabel('Название вещи', { exact: true })).toHaveValue('Green AI T-shirt');
  await page.getByRole('button', { name: 'Отменить добавление', exact: true }).click();
  await expect(page.getByLabel('Фотография вещи', { exact: true })).toBeVisible();
});
