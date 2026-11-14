import { test, expect } from '@playwright/test';
import { Team, createPlan, validateSpec } from '../../src/engine';

test('extended insights are optional, read-only and show actual construction and repair state', async ({ page }) => {
  test.setTimeout(90_000);
  let requests = 0;
  await page.route('**/api/plan', route => { requests++; return route.abort(); });
  await page.goto('/');
  const panel = page.locator('#agent-insights');
  await expect(panel).not.toHaveAttribute('open', '');
  const summary = panel.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveAttribute('open', '');
  await expect(panel.locator('#insight-state')).toContainText('No plan loaded');
  const team = new Team(createPlan(validateSpec({
    world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 5,
    design: { name: 'Structure', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame', repeat: { count: 4, dx: 0, dy: 1, dz: 0 } },
      { x: 0, y: 4, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
    ] },
  }, 'jurassic'), [], 'copilot'));
  const brief = 'Structure 🚀 <img src=x onerror=alert(1)>';
  await page.locator('#import-file').setInputFiles({
    name: 'insights.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(team.snapshot(brief))),
  });
  await expect(panel.locator('tbody tr')).toHaveCount(5);
  await expect(panel.locator('dd').nth(0)).toHaveText(brief);
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.locator('dd').nth(2)).toHaveText('0 / 5');
  await expect(panel.locator('dt').nth(3)).toHaveText('Not currently placed');
  await expect(panel.locator('dd').nth(3)).toHaveText('5');
  await expect(panel.locator('[data-insight-agent="detail"]')).toContainText('Waiting for prerequisites');
  await page.locator('#step').click();
  await expect(panel.locator('dd').nth(2)).toHaveText('1 / 5');
  await expect(panel.locator('[data-insight-agent="frame"]')).toContainText('handoff');
  await page.locator('#run').click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 20_000 });
  await expect(panel.locator('dd').nth(2)).toHaveText('5 / 5');
  await expect(panel.locator('[data-insight-agent="check"]')).toContainText('passed inspection');
  await page.locator('#damage').click();
  await expect(panel.locator('dt').nth(3)).toHaveText('Not currently placed');
  await expect(panel.locator('dd').nth(3)).toHaveText('2');
  await page.locator('#repair').click();
  await expect(panel.locator('dd').nth(3)).toHaveText('0');
  const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
  await summary.click();
  await summary.click();
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
  await page.setViewportSize({ width: 390, height: 844 });
  const ownedCopy = ':scope > p, .insight-context > section > p:not(:has(code)), dt, tbody th > p';
  const englishCopy = await panel.locator(ownedCopy).allTextContents();
  for (const [language, heading, memory, latest, missing] of [
    ['en', 'Extended agent insights', 'Shared memory', 'Latest recorded action', 'Not currently placed'],
    ['de', 'Erweiterte Agenteneinblicke', 'Gemeinsamer Speicher', 'Letzte protokollierte Aktion', 'Derzeit nicht gesetzt'],
    ['fr', 'Comprendre les agents en détail', 'Mémoire partagée', 'Dernière action enregistrée', 'Actuellement non placées'],
    ['it', 'Approfondimenti sugli agenti', 'Memoria condivisa', 'Ultima azione registrata', 'Attualmente non posati'],
    ['es', 'Información avanzada sobre agentes', 'Memoria compartida', 'Última acción registrada', 'No colocados actualmente'],
    ['pt', 'Conheça os agentes em detalhe', 'Memória compartilhada', 'Última ação registrada', 'Não colocados no momento'],
  ]) {
    await page.locator('#language').selectOption(language);
    await expect(summary).toHaveText(heading);
    await expect(panel.getByRole('heading', { name: memory })).toBeVisible();
    await expect(panel.getByRole('columnheader', { name: latest })).toBeVisible();
    await expect(panel.locator('dt').nth(3)).toHaveText(missing);
    await expect(panel.locator('dd').nth(0)).toHaveText(brief);
    if (language !== 'en')
      for (const text of await panel.locator(ownedCopy).allTextContents()) expect(englishCopy).not.toContain(text);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  expect(requests).toBe(0);
});
