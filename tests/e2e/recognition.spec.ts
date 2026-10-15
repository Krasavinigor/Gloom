import sharp from 'sharp';
import { expect, test } from './fixtures';
import { createDatabase } from '../../src/server/db/connection';
import { resolveIntegrationDatabaseUrl } from '../../src/server/config/test-database';

function fixtureDatabase() {
  const schema = process.env.E2E_MANAGED_SCHEMA ?? '';
  if (!/^wardrobe_e2e_[a-f0-9]{32}$/.test(schema) || process.env.DATABASE_SCHEMA !== schema) {
    throw new Error('Recognition browser fixtures require their own database schema.');
  }
  const url = resolveIntegrationDatabaseUrl(undefined, process.env.DATABASE_URL);
  if (!url) throw new Error('Browser fixture database unavailable.');
  return createDatabase(url, schema);
}

async function photo() {
  return { name: 'recognition.jpg', mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 700, height: 900, channels: 3, background: '#62826c' } }).jpeg().toBuffer() };
}

test('recognition resumes through SSE after refresh, preserves edits and applies only on request', async ({ page }, info) => {
  const starts: string[] = [];
  const statusGets: string[] = [];
  page.on('request', (request) => {
    if (/\/recognition$/.test(request.url()) && request.method() === 'POST') starts.push(request.url());
    if (/\/api\/operations\//.test(request.url()) && request.method() === 'GET') statusGets.push(request.url());
  });
  await page.goto('/wardrobe');
  await page.getByLabel('Фотография вещи').setInputFiles(await photo());
  await page.getByRole('button', { name: 'Загрузить фото' }).click();
  const recognize = page.getByRole('button', { name: 'Распознать одежду', exact: true });
  await expect(recognize).toBeEnabled();
  const draftId = new URL(page.url()).searchParams.get('draft')!;
  await recognize.click();
  await expect(page.getByRole('button', { name: 'Распознавание выполняется' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Распознавание выполняется' })).toBeDisabled();
  const manualName = `Моё описание ${info.project.name}`;
  await page.getByLabel('Название вещи').fill(manualName);
  await expect(page.getByText('Распознавание завершено. Проверьте описание.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Название вещи')).toHaveValue(manualName);
  expect(starts).toHaveLength(1);
  expect(statusGets).toEqual([]);
  const database = fixtureDatabase();
  try {
    const operations = await database('ai_operations').where({ target_id: draftId });
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: 'succeeded', attempts: 1, request_id: 'req_browser_fixture' });
    const ledger = await database('ai_cost_ledger').where({ operation_id: operations[0].id }).first();
    expect(ledger.settlement_state).toBe('confirmed');
    expect(Number(ledger.confirmed_micro_usd)).toBeGreaterThan(0);
  } finally { await database.destroy(); }
  await page.getByRole('button', { name: 'Применить AI-описание к форме' }).click();
  await expect(page.getByLabel('Название вещи')).toHaveValue('Зелёная футболка AI');
  const savedName = `Проверенная футболка ${info.project.name}`;
  await page.getByLabel('Название вещи').fill(savedName);
  await page.getByRole('button', { name: 'Сохранить вещь', exact: true }).click();
  await expect(page.getByRole('heading', { name: savedName, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: savedName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Удалить ${savedName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Да, удалить вещь' }).click();
  await expect(page.getByRole('heading', { name: savedName, exact: true })).toHaveCount(0);
});

test('exhausted AI budget keeps a manual wardrobe card available without admission', async ({ page, request }) => {
  const database = fixtureDatabase();
  const month = new Date().toISOString().slice(0, 7);
  const previous = await database('ai_budget_months').where({ month }).first();
  await database('ai_budget_months').insert({ month, limit_micro_usd: 0 }).onConflict('month').merge({ limit_micro_usd: 0 });
  try {
    await page.goto('/wardrobe');
    await page.getByLabel('Фотография вещи').setInputFiles(await photo());
    await page.getByRole('button', { name: 'Загрузить фото' }).click();
    await expect(page.getByText('Бюджет AI исчерпан или зарезервирован. Ручное описание доступно.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Распознать одежду', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Название вещи')).toBeEditable();
    const draftId = new URL(page.url()).searchParams.get('draft')!;
    const denied = await request.post(`/api/garment-drafts/${draftId}/recognition`, {
      headers: { origin: 'http://127.0.0.1:3100', 'Idempotency-Key': crypto.randomUUID() }, data: {},
    });
    expect(denied.status()).toBe(429);
    expect(await database('ai_operations').where({ target_id: draftId })).toHaveLength(0);
    await page.getByRole('button', { name: 'Отменить добавление', exact: true }).click();
    await expect(page.getByLabel('Фотография вещи')).toBeVisible();
  } finally {
    await database('ai_budget_months').where({ month }).update({ limit_micro_usd: previous?.limit_micro_usd ?? 10_000_000 });
    await database.destroy();
  }
});
