import { test, expect } from '@playwright/test';
import { createPlan, parseBrief } from '../../src/engine';

test('Jurassic build supports pause, step, repair, replay, download and restore', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /prehistoric/ })).toBeVisible();
  await page.getByLabel('What shall we build?').fill('Build a purple brachiosaurus with a tall neck.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  await page.getByRole('button', { name: 'Build one step' }).click();
  await expect(page.locator('#brick-count')).toContainText('1 /');
  await page.getByRole('button', { name: 'Continue build' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Pause build' }).click();
  const paused = await page.locator('#brick-count').textContent();
  await page.waitForTimeout(400);
  expect(await page.locator('#brick-count').textContent()).toBe(paused);
  await page.getByLabel('Fast-forward speed, currently 1 times').click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await page.getByRole('button', { name: 'Continue build' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 15_000 });
  await expect(page.locator('#inspection-result')).toHaveText('4/4 checks');
  await page.getByRole('button', { name: 'Hide one brick' }).click();
  await expect(page.locator('#stage-status')).toContainText('missing brick');
  await page.getByRole('button', { name: 'Ask team to repair' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete');
  await expect(page.locator('#event-list')).toContainText('missing eyes brick');
  await page.getByLabel('Replay placed bricks').fill('20');
  await expect(page.locator('#replay-label')).toContainText('20 /');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save build file' }).click();
  expect((await download).suggestedFilename()).toBe('bricklab-brachiosaurus.json');
  await page.reload();
  await expect(page.locator('#stage-status')).toContainText('Mission complete');
  await page.getByRole('button', { name: 'Space dock' }).click();
  await page.getByRole('button', { name: 'Jurassic valley' }).click();
  await expect(page.getByLabel('What shall we build?')).toHaveValue(/purple brachiosaurus/);
  await expect(page.locator('#inspection-result')).toHaveText('4/4 checks');
  await page.getByRole('button', { name: 'They choose actions and share progress' }).click();
  await expect(page.locator('#quiz-feedback')).toContainText('Team Scientist');
  expect(errors).toEqual([]);
});

test('space build exposes dependencies and exploded view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Space dock' }).click();
  await page.getByLabel('What shall we build?').fill('Build a white cargo spaceship with two engines.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await page.getByRole('button', { name: 'Task board' }).click();
  await expect(page.locator('#task-list')).toContainText('Waits for');
  await page.getByLabel('Fast-forward speed, currently 1 times').click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 15_000 });
  await expect(page.locator('#inspection-result')).toHaveText('4/4 checks');
  await page.getByRole('button', { name: 'Toggle exploded view' }).click();
  await expect(page.getByRole('button', { name: 'Toggle exploded view' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('mobile layout, crew interaction and input failures remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('#mission-title')).toHaveText('A little prehistoric. A lot of possibility.');
  await expect(page.locator('.agent-name small')).toHaveText(['Coordinator', 'Structure specialist', 'Finishing specialist']);
  for (const role of await page.locator('.agent-name small').all()) await expect(role).toBeVisible();
  expect(await page.locator('.stage + .transport + .team-panel').count()).toBe(1);
  const quiz = await page.locator('#quiz-options').boundingBox();
  const files = await page.locator('.file-actions').boundingBox();
  expect(quiz).not.toBeNull();
  expect(files).not.toBeNull();
  expect(files!.y).toBeGreaterThanOrEqual(quiz!.y + quiz!.height);
  await page.getByRole('button', { name: 'Run a guided demo' }).click();
  await expect(page.locator('#stage-status')).toContainText('Teamwork');
  await page.getByRole('button', { name: 'Pause build' }).click();
  await page.getByRole('textbox', { name: 'Ask your crew' }).fill('Why wait?');
  await page.getByRole('button', { name: 'Ask crew', exact: true }).click();
  await expect(page.locator('#crew-answer')).toContainText('supporting part');
  await page.getByLabel('What shall we build?').fill('Build a spaceship.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Switch to Space');
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('.control-deck > .transport')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.stage + .transport + .team-panel')).toHaveCount(1);
});

test('a three-agent AI mission can be loaded and its decisions executed, without a model call', async ({ page }) => {
  const spec = parseBrief('space', 'red explorer with wide wings').spec;
  const plan = createPlan(spec);
  const mission = {
    kind: 'bricklab-ai-mission', version: 1, spec, brief: 'red explorer with wide wings', model: 'test-fixture-not-a-live-model',
    decisions: ['build', 'frame', 'detail'].map(agent => ({
      agent, explanation: `Synthetic test fixture: ${agent} coordinates using the shared board.`,
      taskOrder: plan.tasks.filter(t => t.agent === agent).map(t => t.id).reverse(),
    })),
  };
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({
    name: 'ai-mission.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(mission)),
  });
  await expect(page.locator('#event-list')).toContainText('Synthetic test fixture');
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  await expect(page.getByLabel('What shall we build?')).toHaveValue('red explorer with wide wings');
  await page.getByLabel('Fast-forward speed, currently 1 times').click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(page.locator('#inspection-result')).toHaveText('4/4 checks', { timeout: 15_000 });
  await page.locator('#import-file').setInputFiles({
    name: 'bad-mission.json', mimeType: 'application/json', buffer: Buffer.from('{"version":123}'),
  });
  await expect(page.getByRole('alert')).toContainText('Could not load');
  await expect(page.locator('#inspection-result')).toHaveText('4/4 checks');
});

test('Copilot provider failures are visible and never become a fake AI build', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { copilot: true, sessionKey: 'fixture' } }));
  await page.route('**/api/plan', route => route.fulfill({ status: 502, json: { error: 'Copilot unavailable in this test.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Copilot planning' }).click();
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Copilot unavailable');
  await expect(page.locator('#stage-status')).toContainText('Ready for your imagination');
  await expect(page.getByRole('button', { name: 'Start building' })).toBeDisabled();
});
