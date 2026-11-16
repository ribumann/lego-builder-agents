import { test, expect } from '@playwright/test';
import { Team, createPlan, validateSpec } from '../../src/engine';

for (const [width, facing] of [[1440, 1], [390, -1]]) {
    test(`custom ${facing > 0 ? '+X' : '-X'} facing survives orbit, reset and restore at ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors: string[] = [];
      let providerRequests = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (/\/api\/(?:plan|local-plan|compatible-plan|azure-plan)$/.test(new URL(request.url()).pathname))
          providerRequests++;
      });
      const bricks = [
        { x: -3, y: 0, z: -2, width: 6, height: 2, depth: 4, color: 'white', part: 'frame' },
        { x: 3, y: 0, z: -2, width: 1, height: 2, depth: 4, color: 'blue', part: 'detail' },
        { x: 2, y: 2, z: -1, width: 1, height: 1, depth: 2, color: 'black', part: 'detail' },
        { x: -4, y: 0, z: -1, width: 1, height: 1, depth: 2, color: 'orange', part: 'detail' },
        { x: -3, y: 2, z: 0, width: 1, height: 2, depth: 1, color: 'red', part: 'detail' },
      ].map(brick => ({ ...brick, x: facing > 0 ? brick.x : -brick.x - brick.width }));
      const spec = validateSpec({
        world: 'space', model: 'custom', color: 'white', longTail: false, wideWings: false, budget: bricks.length,
        design: { name: 'Synthetic orientation fixture: blue front, orange rear', bricks },
      }, 'space');
      const team = new Team(createPlan(spec));
      while (team.step(20)) {}
      await page.goto('/');
      await page.locator('#import-file').setInputFiles({
        name: 'orientation.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(team.snapshot('Synthetic orientation fixture, not model output'))),
      });
      const canvas = page.locator('#canvas-host canvas');
      await expect(canvas).toHaveAttribute('data-model-bodies', '5');
      await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
      await canvas.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const imagePath = testInfo.outputPath('default-camera.png');
      const initial = await canvas.screenshot({ path: imagePath });
      await testInfo.attach('default-camera', { path: imagePath, contentType: 'image/png' });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-space')!).spec);
      expect(saved).toEqual(spec);
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.mouse.move(0, 0);
      const orbited = await canvas.screenshot();
      expect(orbited).not.toEqual(initial);
      const flip = page.getByRole('button', { name: 'Flip camera 180 degrees' });
      await flip.click();
      await expect(flip).toHaveAttribute('aria-pressed', 'true');
      await page.mouse.move(0, 0);
      const oppositePath = testInfo.outputPath('opposite-camera.png');
      const opposite = await canvas.screenshot({ path: oppositePath });
      await testInfo.attach('opposite-camera', { path: oppositePath, contentType: 'image/png' });
      expect(opposite).not.toEqual(orbited);
      await flip.click();
      await expect(flip).toHaveAttribute('aria-pressed', 'false');
      await page.mouse.move(0, 0);
      expect(await canvas.screenshot()).toEqual(orbited);
      await page.getByRole('button', { name: 'Reset camera' }).click();
      await page.mouse.move(0, 0);
      expect(await canvas.screenshot()).toEqual(initial);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Space dock' }).click();
      await expect(canvas).toHaveAttribute('data-model-bodies', '5');
      await canvas.scrollIntoViewIfNeeded();
      expect(await canvas.screenshot()).toEqual(initial);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-space')!).spec)).toEqual(saved);
      expect(providerRequests).toBe(0);
      expect(errors).toEqual([]);
    });
}
