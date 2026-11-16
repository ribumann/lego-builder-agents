import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test('rough selected target survives save and restore in plan provenance', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => route.fulfill({ json: { spec: {
    world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 1,
    design: { name: 'Tower', bricks: [{ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' }] },
  } } }));
  await page.goto('/');
  await page.locator('#scene-size').selectOption('2000');
  await page.locator('#brief').fill('A tower');
  await page.locator('#plan').click();
  await expect(page.locator('#planning-dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic') || '{}').assumptions))
    .toContain('Approximate planning target: 2000 bricks; Selected size: 2000. A rough target, not an exact output guarantee.');
  await page.reload();
  await expect(page.locator('#event-list')).toContainText('Approximate planning target: 2000 bricks');
});

test('invalid scene target preserves image consent and avoids reading the attachment', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', compatiblePlanner: { enabled: true, state: 'configured', message: 'Ready', destination: 'https://provider.example', vision: true },
  } }));
  let requests = 0;
  await page.route('**/api/compatible-plan', route => {
    requests++;
    return route.fulfill({ status: 503, json: { error: 'Must not be reached.' } });
  });
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      document.documentElement.dataset.imageReading = 'true';
      return original.call(this);
    };
  });
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-compatible').click();
  await page.locator('#media-privacy > summary').click();
  await page.locator('#image-file').setInputFiles(resolve('tests', 'fixtures', 'vision-fixture.jpg'));
  await page.locator('#image-consent').check();
  await page.locator('#brief').fill('build -5 bricks');
  await page.locator('#plan').click();
  await expect(page.locator('#notice')).toContainText('between 1 and 8192');
  await expect(page.locator('#image-consent')).toBeChecked();
  expect(await page.locator('html').getAttribute('data-image-reading')).toBeNull();
  expect(requests).toBe(0);
});

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
