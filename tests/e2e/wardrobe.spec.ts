import { expect, test } from './fixtures';
import sharp from 'sharp';

const photo = async () => ({ name: 'футболка.jpg', mimeType: 'image/jpeg',
  buffer: await sharp({ create: { width: 700, height: 900, channels: 3, background: '#ccd6cf' } }).jpeg().toBuffer() });

test('manual wardrobe survives refresh, editing and confirmed deletion without AI', async ({ page, request }, info) => {
  const name = `Тестовая футболка ${info.project.name}`;
  const updated = `Исправленная футболка ${info.project.name}`;
  const externalRequests: string[] = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(req.url());
  });
  await page.goto('/wardrobe');
  await page.getByLabel('Фотография вещи').setInputFiles(await photo());
  await expect(page.getByAltText('Предпросмотр выбранной фотографии')).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить фото' }).click();
  await expect(page.getByLabel('Название вещи')).toBeVisible();
  await expect(page).toHaveURL(/draft=/);
  await page.reload();
  await page.getByLabel('Название вещи').fill(name);
  await page.getByRole('checkbox', { name: 'Лето', exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить вещь' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const html = await request.get('/wardrobe');
  expect(await html.text()).toContain(name);
  await page.getByRole('button', { name: `Редактировать ${name}` }).click();
  await page.getByLabel('Название вещи').fill(updated);
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.getByRole('heading', { name: updated, exact: true })).toBeVisible();
  const img = page.getByAltText(updated);
  const url = await img.getAttribute('src');
  expect((await request.get(url!)).status()).toBe(200);
  await expect(img).toBeVisible();
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).not.toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('wardrobe.png'), fullPage: true });
  await page.getByRole('button', { name: `Удалить ${updated}` }).click();
  await expect(page.getByRole('button', { name: 'Оставить вещь' })).toBeFocused();
  await page.getByRole('button', { name: 'Да, удалить вещь' }).click();
  await expect(page.getByRole('heading', { name: updated, exact: true })).toHaveCount(0);
  expect((await request.get(url!)).status()).toBe(404);
  await page.reload();
  await expect(page.getByRole('heading', { name: updated, exact: true })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  expect(externalRequests).toEqual([]);
});

test('local SSR and APIs reject foreign hosts and origins', async ({ request }) => {
  for (const path of ['/wardrobe', '/api/garments']) {
    expect((await request.get(path, { headers: { host: 'evil.test:3100' } })).status()).toBe(403);
  }
  const wrongOrigin = await request.post('/api/garments', {
    headers: { origin: 'https://evil.test' }, data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  expect((await request.get('/api/garments')).status()).toBe(200);
});
