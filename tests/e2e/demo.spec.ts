import { expect, test } from './fixtures';

test('demo requires a manual selection and resets outfits for a new scenario', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) {
      externalRequests.push(new URL(request.url()).hostname);
    }
  });
  await page.goto('/demo');
  await expect(page.getByText('Демонстрация: пример погодных условий')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Лёгкий день' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подобрать образы' }).click();
  await expect(page.getByRole('heading', { name: 'Лёгкий день' })).toBeVisible();
  await page.getByRole('button', { name: /Дождливо/ }).click();
  await expect(page.getByRole('heading', { name: 'Лёгкий день' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подобрать образы' }).click();
  await expect(page.getByRole('heading', { name: 'Под защитой' })).toBeVisible();
  await page.getByRole('button', { name: 'Вопросы об образах' }).click();
  await page.getByRole('button', { name: 'Почему эти вещи?' }).click();
  await expect(page.getByText(/Это готовый пример ответа/)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('дождевик');
  expect(externalRequests).toEqual([]);
});

test('the demo wardrobe is server rendered and remains separate from the personal shell', async ({ page, request }) => {
  const response = await request.get('/demo/wardrobe');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Молочная футболка');
  await page.goto('/demo/wardrobe');
  await expect(page.getByRole('heading', { name: 'Демогардероб', exact: true })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(15);
  await expect(page.getByRole('button', { name: /удалить|редактировать|загрузить/i })).toHaveCount(0);
  await page.goto('/wardrobe');
  await expect(page.getByRole('heading', { name: 'Молочная футболка', exact: true })).toHaveCount(0);
  await page.goto('/outfits');
  await expect(page.getByRole('heading', { name: 'Образы на день' })).toBeVisible();
  await page.getByRole('link', { name: 'Посмотреть демо', exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
});

test('demo supports keyboard navigation and fits the viewport', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Подобрать образы' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Лёгкий день' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Вопросы об образах' })).toBeVisible();
});
