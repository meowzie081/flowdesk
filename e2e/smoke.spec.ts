import { expect, test, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, 'Задайте E2E_EMAIL и E2E_PASSWORD в .env (тестовый аккаунт)');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email или логин').fill(email!);
  await page.getByLabel('Пароль', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваши отделы' })).toBeVisible({ timeout: 45_000 });
}

test('вход и открытие доски', async ({ page }) => {
  await login(page);
  await page.locator('ul a.card').first().click();
  await page.getByRole('link', { name: 'Канбан' }).click();
  await expect(page.getByRole('heading', { name: /Backlog/ })).toBeVisible({ timeout: 20_000 });
});

test('создание, перемещение и архивация задачи', async ({ page }) => {
  const title = `E2E smoke ${Date.now()}`;
  await login(page);
  await page.locator('ul a.card').first().click();
  await page.getByRole('link', { name: 'Канбан' }).click();
  await expect(page.getByRole('heading', { name: /Backlog/ })).toBeVisible({ timeout: 20_000 });

  const backlog = page.locator('section', { has: page.getByRole('heading', { name: /Backlog/ }) });
  await backlog.getByPlaceholder('Новая задача').fill(title);
  await backlog.getByRole('button', { name: '+', exact: true }).click();

  const card = page.locator('li.task-card', { hasText: title });
  await expect(card).toBeVisible({ timeout: 15_000 });

  await card.getByLabel('Переместить в колонку').selectOption({ label: 'В работе' });
  const inProgress = page.locator('section', { has: page.getByRole('heading', { name: /В работе/ }) });
  await expect(inProgress.locator('li.task-card', { hasText: title })).toBeVisible({ timeout: 15_000 });

  await inProgress.locator('li.task-card', { hasText: title }).getByRole('button', { name: 'В архив' }).click();
  await expect(page.locator('li.task-card', { hasText: title })).toHaveCount(0, { timeout: 15_000 });
});