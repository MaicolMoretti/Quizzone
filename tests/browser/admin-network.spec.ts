/**
 * Verifica accesso e navigazione quando il browser non può raggiungere Supabase
 * direttamente e controlla che il proxy rifiuti percorsi non supportati.
 */
import { test, expect } from '@playwright/test';

test('admin login and dashboard work when the browser cannot reach Supabase directly', async ({ page }) => {
  await page.route('http://127.0.0.1:54325/**', route => route.abort('failed'));
  await page.goto('/login');
  await page.getByLabel('Email').fill('host@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  const login = page.waitForResponse(response => response.url().includes('/api/supabase/auth/v1/token'));
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('host@example.test', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
});

test('proxy does not forward arbitrary paths', async ({ request }) => {
  expect((await request.get('/api/supabase/unknown/path')).status()).toBe(404);
});
