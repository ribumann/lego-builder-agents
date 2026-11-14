import { test, expect } from '@playwright/test';

test('hollow preference is explicit and cutaway never changes saved geometry', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => {
    requests.push(route.request().postDataJSON());
    const box = (x: number, y: number, z: number, width: number, height: number, depth: number, detail = false) =>
      ({ x, y, z, width, height, depth, color: detail ? 'orange' : 'blue', part: detail ? 'detail' : 'frame' });
    return route.fulfill({ json: { spec: {
      world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 8,
      design: { name: 'Hollow room fixture', bricks: [
        box(0, 0, 0, 5, 1, 5), box(0, 1, 0, 5, 3, 1),
        box(0, 1, 1, 1, 3, 4), box(4, 1, 1, 1, 3, 4),
        box(1, 1, 4, 1, 3, 1), box(3, 1, 4, 1, 3, 1),
        box(0, 4, 0, 5, 1, 5), box(1, 1, 2, 1, 1, 1, true),
      ] },
    } } });
  });
  await page.goto('/');
  await expect(page.locator('#hollow-interior')).not.toBeChecked();
  await page.locator('#hollow-interior').check();
  const brief = 'A small blue room with an open doorway and an orange chair';
  await page.locator('#brief').fill(brief);
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#scene-caption')).toContainText('Hollow room fixture');
  expect(requests).toEqual([{ world: 'jurassic', brief, hollowInterior: true }]);
  await page.locator('#run').click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 20_000 });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
  await page.locator('#blueprint').click();
  await page.locator('#interior-view').click();
  await expect(page.locator('#interior-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#canvas-host canvas')).toHaveAttribute('data-model-bodies', '8');
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
  await page.locator('#damage').click();
  await page.locator('#repair').click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 20_000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
  expect(after.spec).toEqual(before.spec);
  expect(after.bricks.slice().sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)))
    .toEqual(before.bricks.slice().sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)));
  await page.reload();
  await expect(page.locator('#brick-count')).toHaveText('8 / 8 bricks');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await expect(page.locator('#hollow-interior')).toBeDisabled();
  expect(requests).toHaveLength(1);
});

test('hollow controls and explanation localize in six languages on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const [language, label, title, explanation] of [
    ['en', 'Try a hollow interior', 'Cutaway view', 'a preference, not a guarantee'],
    ['de', 'Hohlraum ausprobieren', 'Schnittansicht', 'ein Wunsch, keine Garantie'],
    ['fr', 'Essayer un intérieur creux', 'Vue en coupe', 'une préférence, pas une garantie'],
    ['it', 'Prova un interno cavo', 'Vista in sezione', 'una preferenza, non una garanzia'],
    ['es', 'Probar un interior hueco', 'Vista en corte', 'una preferencia, no una garantía'],
    ['pt', 'Experimentar um interior oco', 'Vista em corte', 'uma preferência, não uma garantia'],
  ]) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('.interior-option strong')).toHaveText(label);
    await expect(page.locator('#interior-view')).toHaveAttribute('title', title);
    await page.locator('#ask-interior').click();
    await expect(page.locator('#crew-answer')).toContainText(explanation);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});
