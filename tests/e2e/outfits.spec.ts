import type { APIRequestContext, Page } from '@playwright/test';
import sharp from 'sharp';
import { expect, test } from './fixtures';
import { createDatabase } from '../../src/server/db/connection';
import type { Garment, GarmentFields } from '../../src/features/wardrobe/schema';

const headers = { origin: 'http://127.0.0.1:3100' };
function fixtureDatabase() {
  const schema = process.env.E2E_MANAGED_SCHEMA ?? '';
  if (!/^wardrobe_e2e_[a-f0-9]{32}$/.test(schema) || process.env.DATABASE_SCHEMA !== schema) {
    throw new Error('Outfit browser fixtures require an isolated database schema.');
  }
  return createDatabase(process.env.DATABASE_URL!, schema);
}
async function seed(request: APIRequestContext, saved: Garment[], suffix: string) {
  const photo = await sharp({ create: { width: 700, height: 900, channels: 3, background: '#62826c' } }).jpeg().toBuffer();
  const entries = [
    ['t_shirt', 'Футболка'], ['trousers', 'Брюки'], ['boots', 'Сапоги'],
    ['sweater', 'Свитер'], ['jacket', 'Куртка'], ['t_shirt', 'Запасная футболка'],
  ] as const;
  for (const [type, name] of entries) {
    const upload = await request.post('/api/garment-drafts', { headers, multipart: {
      photo: { name: 'outfit.jpg', mimeType: 'image/jpeg', buffer: photo },
    } });
    expect(upload.status()).toBe(201);
    const draft = (await upload.json()).data;
    const fields: GarmentFields = { name: `${name} ${suffix}`, type,
      bodyAreas: [type === 'boots' ? 'feet' : type === 'trousers' ? 'legs' : 'torso'],
      layers: type === 'boots' ? [] : [type === 'sweater' ? 'middle' : type === 'jacket' ? 'outer' : 'base'],
      seasons: ['midseason'], color: 'зелёный', pattern: '', warmth: 'warm',
      temperature: null, rainProtection: 'unknown', windProtection: 'unknown' };
    const response = await request.post('/api/garments', { headers, data: { draftId: draft.id, fields } });
    expect(response.status()).toBe(201);
    saved.push((await response.json()).data);
  }
}
async function city(page: Page) {
  await page.getByLabel('Город', { exact: true }).fill('Москва');
  await page.getByRole('button', { name: 'Найти город', exact: true }).click();
  await page.getByRole('button', { name: /^Выбрать Москва,/ }).click();
  await expect(page.getByRole('region', { name: 'Погода для выбранного места' })).toContainText('12 °C');
}

test('manual outfit selection resumes with SSE, replaces locally, and preserves results after a failed new selection', async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const database = fixtureDatabase();
  const saved: Garment[] = [];
  const starts: string[] = [];
  const statusGets: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/outfit-selections') && request.method() === 'POST') starts.push(request.url());
    if (/\/api\/operations\//.test(request.url()) && request.method() === 'GET') statusGets.push(request.url());
  });
  try {
    await seed(request, saved, info.project.name);
    await page.goto('/outfits');
    await city(page);
    const panel = page.getByRole('region', { name: 'Подбор образов', exact: true });
    const button = panel.getByRole('button', { name: 'Подобрать образы', exact: true });
    await expect(button).toBeEnabled();
    const count = await database('ai_operations').where({ kind: 'outfits' }).count('* as count').first();
    expect(starts).toHaveLength(0);
    await button.click();
    await expect(panel.getByRole('button', { name: 'Подбор выполняется' })).toBeDisabled();
    await page.reload();
    await expect(panel.getByRole('button', { name: 'Подобрать образы', exact: true })).toBeEnabled({ timeout: 15_000 });
    await expect(panel.getByRole('heading', { name: 'Образ для прогулки', exact: true })).toBeVisible({ timeout: 15_000 });
    expect(starts).toHaveLength(1);
    expect(statusGets).toEqual([]);
    const operations = await database('ai_operations').where({ kind: 'outfits' }).orderBy('created_at', 'desc');
    expect(operations).toHaveLength(Number(count!.count) + 1);
    expect(operations[0]).toMatchObject({ status: 'succeeded', attempts: 1, request_id: 'req_outfits_browser_fixture' });
    const ledgerBefore = await database('ai_cost_ledger').count('* as count').first();
    const background = await panel.locator('img[aria-hidden="true"]').getAttribute('src');
    expect(background).toMatch(/^\/weather-backgrounds\//);
    expect(background).not.toContain('default');
    await panel.getByRole('button', { name: 'Заменить: Основной верх', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Замена: Основной верх', exact: true }).selectOption(saved[5].id);
    await panel.getByRole('button', { name: 'Применить замену', exact: true }).click();
    await expect(panel.getByText(saved[5].fields.name, { exact: true })).toBeVisible();
    await page.reload();
    await expect(panel.getByText(saved[5].fields.name, { exact: true })).toBeVisible();
    expect(await panel.locator('img[aria-hidden="true"]').getAttribute('src')).toBe(background);
    expect(await database('ai_cost_ledger').count('* as count').first()).toEqual(ledgerBefore);
    expect(starts).toHaveLength(1);
    const changed = await request.patch(`/api/garments/${saved[0].id}`, { headers,
      data: { version: saved[0].version, fields: { ...saved[0].fields, name: 'E2E_PROVIDER_FAILURE' } } });
    expect(changed.status()).toBe(200);
    await page.reload();
    await expect(panel.getByText('Эти образы требуют нового подбора.', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Заменить:/ })).toHaveCount(0);
    expect(await panel.locator('img[aria-hidden="true"]').getAttribute('src')).toContain('default');
    await panel.getByRole('button', { name: 'Подобрать образы', exact: true }).click();
    await expect(panel.getByText('Не удалось подобрать образы. Проверьте гардероб и условия.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(saved[5].fields.name, { exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Образ для прогулки', exact: true })).toBeVisible();
    expect(starts).toHaveLength(2);
    expect(statusGets).toEqual([]);
    await page.reload();
    await expect(panel.getByText(saved[5].fields.name, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath('outfits-stale.png'), fullPage: true });
  } finally {
    const response = await request.get('/api/garments');
    const current: Garment[] = (await response.json()).data.garments;
    for (const garment of current.filter((item) => saved.some((own) => own.id === item.id))) {
      const deleted = await request.delete(`/api/garments/${garment.id}`, { headers, data: { version: garment.version } });
      expect(deleted.status()).toBe(200);
    }
    await database.destroy();
  }
});
