import { test, expect } from '@playwright/test';

test('adding twice preserves placed work across reload and failed planning', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use offline templates' }).click();
  await page.getByLabel('What shall we build?').fill('Build a green stegosaurus.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await page.getByRole('button', { name: 'Build one step' }).click();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
  const original = await saved();
  const geometry = (bricks: { id: string; x: number; y: number; z: number; color: string; part: string }[]) =>
    bricks.map(({ id, x, y, z, color, part }) => ({ id, x, y, z, color, part }));
  expect(original.bricks.length).toBeGreaterThan(0);
  await page.getByLabel('Add to scene').check();
  await page.getByLabel('What shall we build?').fill('Build a purple brachiosaurus.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  const first = await saved();
  expect(geometry(first.bricks)).toEqual(expect.arrayContaining(geometry(original.bricks)));
  await page.getByLabel('What shall we build?').fill('Build an orange stegosaurus.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  const second = await saved();
  expect(geometry(second.bricks)).toEqual(expect.arrayContaining(geometry(original.bricks)));
  expect(second.spec.design.objects.length).toBeGreaterThan(first.spec.design.objects.length);
  await page.reload();
  const reloaded = await saved();
  expect(geometry(reloaded.bricks)).toEqual(expect.arrayContaining(geometry(original.bricks)));
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use offline templates' }).click();
  await page.getByLabel('Add to scene').check();
  await page.getByLabel('What shall we build?').fill('Build a spaceship.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Switch to Space');
  expect(await saved()).toEqual(reloaded);
});

test('adding to an empty scene never submits a model request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.getByLabel('Add to scene').check();
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.getByRole('alert')).toContainText('There is no scene to add to');
  await expect(page.locator('#stage-status')).toContainText('Ready for your imagination');
  expect(requests).toBe(0);
});
