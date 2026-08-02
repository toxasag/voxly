import { expect, test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const storageFile = resolve(here, '.auth/user.json');
const apiUrl = process.env.API_URL || 'http://127.0.0.1:3002';
const email = process.env.E2E_EMAIL || 'test1@test.ru';
const password = process.env.E2E_PASSWORD || 'test123';

setup('authenticate via API', async ({ page, request }) => {
  const login = await request.post(`${apiUrl}/api/auth/login`, {
    data: { email, password },
  });
  expect(login.ok(), `login failed: ${login.status()} ${await login.text()}`).toBeTruthy();
  const body = await login.json();
  expect(body.token).toBeTruthy();

  await page.goto('/login');
  await page.evaluate((token) => {
    localStorage.setItem('voxly_token', token);
    localStorage.setItem('token', token);
  }, body.token as string);

  mkdirSync(dirname(storageFile), { recursive: true });
  await page.context().storageState({ path: storageFile });
  writeFileSync(resolve(here, '.auth/token.txt'), String(body.token));
});
