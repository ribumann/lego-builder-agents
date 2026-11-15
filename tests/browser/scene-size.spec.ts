import { test, expect } from '@playwright/test';

test('scene size shows the effective target and sends one structured selection', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  let requests = 0;
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/plan', async route => {
    requests++;
    body = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { error: 'Fixture response' } });
  });
  await page.goto('/');
  const select = page.locator('#scene-size');
  const status = page.locator('#scene-size-status');
  await expect(select).toHaveValue('1000');
  await select.selectOption('2000');
  await page.locator('#brief').fill('A 500-brick tower');
  await expect(status).toContainText('Target from brief: 500 bricks');
  await page.locator('#plan').click();
  await expect.poll(() => requests).toBe(1);
  expect(body?.sceneSize).toBe(2000);
  expect(body?.brief).toBe('A 500-brick tower');
  await expect(page.locator('#planning-dialog')).toBeHidden();
  await page.locator('#brief').fill('3 towers with 500 bricks');
  await expect(status).toContainText('Target from selection: 2,000 bricks');
  await page.locator('#brief').fill('9000 bricks');
  await expect(status).toContainText('between 1 and 8192');
  await page.locator('#plan').click();
  expect(requests).toBe(1);
  await page.locator('#language').selectOption('de');
  await expect(status).toContainText('zwischen 1 und 8192');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await expect(select).toBeDisabled();
  await expect(status).toContainText('Offline-Vorlagen');
});
