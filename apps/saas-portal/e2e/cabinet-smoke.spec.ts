import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const storageFile = resolve(here, '.auth/user.json');
const skipE2E = process.env.SKIP_E2E === '1' || !existsSync(storageFile);

test.describe.skipIf(skipE2E)('cabinet key screens', () => {
  test.use({ storageState: storageFile });

  test('/dashboard/partners shows partner programme hero', async ({ page }) => {
    await page.goto('/dashboard/partners');
    await expect(page.getByText(/партнёр|партнер/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('/dashboard/crm shows subscription or checkout state', async ({ page }) => {
    await page.goto('/dashboard/crm');
    await expect(
      page.getByText(/CRM|подписк|пробн|оплат/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('/dashboard/ai surfaces trial or channel state', async ({ page }) => {
    await page.goto('/dashboard/ai');
    await expect(
      page.getByText(/Телеграм Секретарь|пробн|подключ|тариф/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('/dashboard/ai/agents shows balance and agent capacity', async ({ page }) => {
    await page.goto('/dashboard/ai/agents');
    await expect(
      page.getByText(/агент|баланс|пополн/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
