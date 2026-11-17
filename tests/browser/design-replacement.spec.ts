import { expect, test, type Page } from '@playwright/test';

async function offline(page: Page) {
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use offline templates' }).click();
}

async function plan(page: Page, brief: string) {
  await page.getByLabel('What shall we build?').fill(brief);
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
const sceneImage = async (page: Page) => {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.locator('#canvas-host canvas').screenshot();
};

test('replacement changes the visible blueprint and persists across refresh', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await offline(page);
  await plan(page, 'Build a green stegosaurus.');
  await expect(page.locator('#scene-caption')).toContainText('green stegosaurus');
  const firstScene = await sceneImage(page);
  const first = await saved(page);
  await plan(page, 'Build a purple brachiosaurus.');
  await expect(page.locator('#scene-caption')).toContainText('purple brachiosaurus');
  const secondScene = await sceneImage(page);
  expect(secondScene.equals(firstScene)).toBe(false);
  const second = await saved(page);
  expect(second.spec).not.toEqual(first.spec);
  await page.reload();
  await expect(page.locator('#scene-caption')).toContainText('purple brachiosaurus');
  expect(await saved(page)).toEqual(second);
  expect((await sceneImage(page)).equals(firstScene)).toBe(false);
});

test('switching worlds in an older tab does not overwrite a newer design', async ({ page, context }) => {
  await page.goto('/');
  await offline(page);
  await plan(page, 'Build a green stegosaurus.');
  const oldTab = await context.newPage();
  await oldTab.goto('/');
  await expect(oldTab.locator('#scene-caption')).toContainText('green stegosaurus');
  await plan(page, 'Build a purple brachiosaurus.');
  const newer = await saved(page);
  await oldTab.getByRole('button', { name: 'Space dock' }).click();
  expect(await saved(page)).toEqual(newer);
  await oldTab.getByRole('button', { name: 'Jurassic valley' }).click();
  await expect(oldTab.locator('#scene-caption')).toContainText('purple brachiosaurus');
  await offline(oldTab);
  await plan(oldTab, 'Build a red stegosaurus.');
  const edited = await saved(oldTab);
  expect(edited.spec.color).toBe('red');
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
  expect(await saved(oldTab)).toEqual(edited);
});

test('closing an older tab does not overwrite a newer design', async ({ page, context }) => {
  await page.goto('/');
  await offline(page);
  await plan(page, 'Build a green stegosaurus.');
  const oldTab = await context.newPage();
  await oldTab.goto('/');
  await expect(oldTab.locator('#scene-caption')).toContainText('green stegosaurus');
  await plan(page, 'Build a red stegosaurus.');
  const latest = await saved(page);
  const closed = oldTab.waitForEvent('close');
  await oldTab.close({ runBeforeUnload: true });
  await closed;
  expect(await saved(page)).toEqual(latest);
  await page.reload();
  await expect(page.locator('#scene-caption')).toContainText('red stegosaurus');
});

test('scene mutations are unavailable while a planning request is pending', async ({ page }) => {
  let releaseStatus: (() => void) | undefined;
  let holdStatus = false;
  await page.route('**/api/status', async route => {
    if (holdStatus) await new Promise<void>(resolve => { releaseStatus = resolve; });
    await route.fulfill({ json: { copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' } } });
  });
  await page.route('**/api/plan', route => route.fulfill({ status: 502, json: { error: 'Fixture failure' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Run an offline demo' }).click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 15_000 });
  const before = await saved(page);
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Copilot planning' }).click();
  holdStatus = true;
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.locator('#stage-status')).toContainText('Planning');
  await expect(page.getByRole('button', { name: 'Hide bricks' })).toBeDisabled();
  await expect(page.getByLabel('Replay placed bricks')).toBeDisabled();
  await expect.poll(() => !!releaseStatus).toBe(true);
  holdStatus = false;
  releaseStatus!();
  await expect(page.getByRole('alert')).toContainText('Fixture failure');
  expect(await saved(page)).toEqual(before);
  await expect(page.locator('#stage-status')).toContainText('Mission complete');
});

test('an invalid brief does not pause an ongoing build', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Run an offline demo' }).click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await page.getByLabel('Fast-forward speed, currently 16 times').click();
  await page.getByLabel('What shall we build?').fill('');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Give the team a brief');
  await expect(page.locator('#stage-status')).toContainText('Teamwork in progress');
  await expect(page.getByRole('button', { name: 'Pause build' })).toBeEnabled();
});
