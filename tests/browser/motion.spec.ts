import { test, expect } from '@playwright/test';
import { Team, createPlan, validateSpec } from '../../src/engine';

test('reduced motion stops robots and follows live preference changes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const team = new Team(createPlan(validateSpec({
    world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 2,
    design: { name: 'Motion fixture', bricks: [
      { x: 0, y: 0, z: 0, width: 3, height: 2, depth: 3, color: 'blue', part: 'frame' },
      { x: 1, y: 2, z: 1, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
    ] },
  }, 'jurassic')));
  while (team.step(20)) {}
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({
    name: 'motion.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(team.snapshot('Motion fixture'))),
  });
  await expect(page.locator('#brick-count')).toHaveText('2 / 2 bricks');
  await page.evaluate(() => window.scrollTo(0, 0));
  const clip = await page.locator('#canvas-host canvas').boundingBox();
  expect(clip).not.toBeNull();
  const initial = await page.screenshot({ clip: clip! });
  await page.waitForTimeout(200);
  expect(await page.screenshot({ clip: clip! })).toEqual(initial);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(200);
  expect(await page.screenshot({ clip: clip! })).not.toEqual(initial);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const stopped = await page.screenshot({ clip: clip! });
  await page.waitForTimeout(200);
  expect(await page.screenshot({ clip: clip! })).toEqual(stopped);
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
});
