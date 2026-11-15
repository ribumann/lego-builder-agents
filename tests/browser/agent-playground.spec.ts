import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentPlaygroundHandle, mountAgentPlayground } from '../../src/agent-playground';

declare global {
  interface Window {
    BrickLabPlayground: { mountAgentPlayground: typeof mountAgentPlayground };
    playgroundTestHandle: AgentPlaygroundHandle;
  }
}

let script = '';
let styles = '';
const clockInstalled = new WeakSet<Page>();
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const built = await build({
    configFile: false, logLevel: 'error',
    build: { write: false, minify: false, lib: {
      entry: resolve('src/agent-playground.ts'), name: 'BrickLabPlayground', formats: ['iife'],
    } },
  });
  for (const result of Array.isArray(built) ? built : [built]) {
    if (!('output' in result)) throw new Error('Playground fixture unexpectedly started a watcher');
    for (const output of result.output) {
      if (output.type === 'chunk') script += output.code;
      else if (output.fileName.endsWith('.css')) styles += String(output.source);
    }
  }
  styles = await readFile(resolve('src/style.css'), 'utf8') + styles;
  expect(script).not.toBe('');
});

async function openLab(page: Page) {
  if (!clockInstalled.has(page)) {
    const now = Date.now();
    await page.clock.install({ time: new Date(now) });
    await page.clock.pauseAt(new Date(now + 1000));
    clockInstalled.add(page);
  }
  await page.route('**/__agent-playground-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent lab test</title><body><main id="lab-test-host"></main></body></html>',
  }));
  await page.goto('/__agent-playground-test');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => {
    window.playgroundTestHandle = window.BrickLabPlayground.mountAgentPlayground(document.getElementById('lab-test-host')!);
    localStorage.setItem('bricklab-jurassic', 'main-workshop-untouched');
  });
  await page.locator('.agent-lab > summary').click();
  return page.locator('[data-agent-playground]');
}

async function finishUntilPaused(page: Page) {
  const step = page.locator('[data-lab-action="step"]');
  for (let n = 0; n < 40 && !await step.isDisabled(); n++) await step.click();
  await expect(step).toBeDisabled();
}

async function startScenario(page: Page, scenario: string) {
  await page.locator('[data-lab-scenario]').selectOption(scenario);
  await page.locator('[data-lab-action="start"]').click();
  await page.locator('[data-lab-action="play"]').click();
}

test('workshop mounts a separate collapsed playground and synchronizes all six languages', async ({ page }) => {
  let planningRequests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'off', message: 'Off' },
  } }));
  await page.route(/\/api\/(?:plan|local-plan|compatible-plan|azure-plan)$/, route => {
    planningRequests++;
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('bricklab-language', 'de');
    localStorage.setItem('bricklab-jurassic', 'main-workshop-untouched');
  });
  await page.goto('/');
  const lab = page.locator('[data-agent-playground]');
  await expect(lab).not.toHaveAttribute('open', '');
  await expect(lab.locator(':scope > summary')).toContainText('Der Agentenspielplatz');
  await lab.locator(':scope > summary').click();
  await lab.locator('[data-lab-action="step"]').click();
  await expect(lab.locator('.lab-event code')).toHaveText('create_plan(…)');
  for (const [language, heading, context] of [
    ['en', 'The agent playground', 'Context'], ['de', 'Der Agentenspielplatz', 'Kontext'],
    ['fr', 'Le terrain des agents', 'Contexte'], ['it', 'Il laboratorio degli agenti', 'Contesto'],
    ['es', 'El patio de los agentes', 'Contexto'], ['pt', 'O laboratório dos agentes', 'Contexto'],
  ] as const) {
    await page.locator('#language').selectOption(language);
    await expect(lab.locator(':scope > summary')).toContainText(heading);
    await expect(lab.getByRole('tab', { name: context, exact: true })).toBeVisible();
    await expect(lab.locator('.lab-event code')).toHaveText('create_plan(…)');
  }
  await expect(lab.locator('[data-lab-agent]')).toHaveCount(6);
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe('main-workshop-untouched');
  expect(await page.evaluate(() => localStorage.getItem('bricklab-agent-playground-memory-v1'))).toBeNull();
  expect(planningRequests).toBe(0);
});

test('tool history replays the actual defect and repair; remembered lesson changes the next build', async ({ page }) => {
  let providers = 0;
  await page.route('**/api/**', route => { providers++; return route.abort(); });
  const lab = await openLab(page);
  await expect(lab.locator('[data-lab-agent]')).toHaveCount(6);
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-status')).toContainText('Verified, repaired, verified again');
  await expect(lab.locator('.lab-placed')).toHaveCount(11);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await lab.screenshot({ path: 'test-results/playground-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await lab.screenshot({ path: 'test-results/playground-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  const defect = lab.locator('.lab-event').filter({ hasText: 'Independent inspection found' });
  await defect.click();
  await expect(lab.locator('[data-part="right-eye"]')).toHaveAttribute('data-y', '104');
  await expect(lab.locator('[data-part="right-eye"]')).toHaveClass(/lab-error/);
  await lab.locator('.lab-tool-detail details').last().locator('summary').click();
  await expect(lab.locator('.lab-tool-detail')).toContainText('"right-eye"');
  await lab.locator('.lab-event').filter({ hasText: 'repair_brick(' }).click();
  await expect(lab.locator('[data-part="right-eye"]')).toHaveAttribute('data-y', '94');
  await expect(lab.locator('[data-part="right-eye"]')).toHaveClass(/lab-repaired/);
  await lab.locator('.lab-event').first().click();
  await expect(lab.locator('.lab-placed')).toHaveCount(0);
  await lab.locator('[data-lab-action="live"]').click();
  await expect(lab.locator('.lab-placed')).toHaveCount(11);
  expect(await page.evaluate(() => localStorage.getItem('bricklab-agent-playground-memory-v1'))).toBeNull();
  await lab.locator('.lab-intervention [data-lab-action="remember"]').click();
  await expect(lab.getByRole('tab', { name: 'Memory', exact: true })).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-agent-playground-memory-v1')!))).toEqual({ version: 1, lesson: 'align-eyes' });
  await startScenario(page, 'robot');
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-status')).toContainText('first inspection');
  await expect(lab.locator('.lab-event').filter({ hasText: 'recall_lesson(' })).toHaveCount(1);
  await expect(lab.locator('.lab-event').filter({ hasText: 'repair_brick(' })).toHaveCount(0);
  await expect(lab.locator('.lab-event').filter({ hasText: 'inspect_build(' })).toHaveCount(1);
  await page.evaluate(() => window.playgroundTestHandle.dispose());
  const reloaded = await openLab(page);
  await finishUntilPaused(page);
  await expect(reloaded.locator('.lab-status')).toContainText('first inspection');
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe('main-workshop-untouched');
  expect(providers).toBe(0);
});

test('missing stock pauses atomically and the player can replan independent work before restocking', async ({ page }) => {
  const lab = await openLab(page);
  await startScenario(page, 'missing');
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-placed')).toHaveCount(5);
  await lab.locator('[data-lab-action="replan"]').click();
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-placed')).toHaveCount(9);
  await expect(lab.locator('[data-lab-action="replan"]')).toHaveCount(0);
  await lab.locator('[data-lab-action="restock"]').click();
  await expect(lab.locator('.lab-placed')).toHaveCount(9);
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-placed')).toHaveCount(11);
  await expect(lab.locator('.lab-status')).toContainText('Verified, repaired');
});

test('invalid plan cannot execute before a player correction and a new verification', async ({ page }) => {
  const lab = await openLab(page);
  await startScenario(page, 'dependency');
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-placed')).toHaveCount(0);
  await lab.locator('[data-lab-action="revise"]').click();
  await expect(lab.locator('.lab-placed')).toHaveCount(0);
  await lab.locator('[data-lab-action="step"]').click();
  await expect(lab.locator('.lab-event').last()).toContainText('check_dependencies(');
  await expect(lab.locator('.lab-placed')).toHaveCount(0);
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-placed')).toHaveCount(11);
});

test('pause, disclosure close and disposal stop playback; tabs support keyboard selection', async ({ page }) => {
  const lab = await openLab(page);
  await lab.locator('[data-lab-action="play"]').click();
  await page.clock.runFor(950);
  await expect(lab.locator('.lab-event')).toHaveCount(2);
  await lab.locator('[data-lab-action="play"]').click();
  await page.clock.runFor(5000);
  await expect(lab.locator('.lab-event')).toHaveCount(2);
  await lab.getByRole('tab', { name: 'Tools', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(lab.getByRole('tab', { name: 'Context', exact: true })).toBeFocused();
  await expect(lab.getByRole('tab', { name: 'Context', exact: true })).toHaveAttribute('aria-selected', 'true');
  await lab.locator('[data-lab-action="play"]').click();
  await lab.locator(':scope > summary').click();
  await page.clock.runFor(5000);
  await expect(lab.locator('.lab-event')).toHaveCount(3);
  await page.evaluate(() => window.playgroundTestHandle.dispose());
  await page.clock.runFor(5000);
  await expect(page.locator('[data-agent-playground]')).toHaveCount(0);
});

test('all six app languages work on mobile with reduced motion and unchanged tool identifiers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const lab = await openLab(page);
  await lab.locator('[data-lab-action="step"]').click();
  for (const [language, heading, context] of [
    ['en', 'The agent playground', 'Context'], ['de', 'Der Agentenspielplatz', 'Kontext'],
    ['fr', 'Le terrain des agents', 'Contexte'], ['it', 'Il laboratorio degli agenti', 'Contesto'],
    ['es', 'El patio de los agentes', 'Contexto'], ['pt', 'O laboratório dos agentes', 'Contexto'],
  ] as const) {
    await page.evaluate(language => window.playgroundTestHandle.setLanguage(language), language);
    await expect(lab.locator(':scope > summary')).toContainText(heading);
    await expect(lab.getByRole('tab', { name: context, exact: true })).toBeVisible();
    await expect(lab.locator('.lab-event code')).toHaveText('create_plan(…)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});

test('unreadable memory is disclosed and can be explicitly cleared without touching workshop saves', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bricklab-agent-playground-memory-v1', '{broken'));
  const lab = await openLab(page);
  await expect(lab.locator('.lab-status')).toContainText('Browser memory is unavailable');
  await lab.getByRole('tab', { name: 'Memory', exact: true }).click();
  await lab.locator('[data-lab-action="forget"]').click();
  await expect(lab.locator('.lab-status')).not.toContainText('unavailable');
  expect(await page.evaluate(() => localStorage.getItem('bricklab-agent-playground-memory-v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe('main-workshop-untouched');
});

test('a rejected memory write is reported instead of claiming the repair was saved', async ({ page }) => {
  const lab = await openLab(page);
  await finishUntilPaused(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bricklab-agent-playground-memory-v1') throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await lab.locator('.lab-intervention [data-lab-action="remember"]').click();
  await expect(lab.locator('.lab-status')).toContainText('Browser memory is unavailable');
  expect(await page.evaluate(() => localStorage.getItem('bricklab-agent-playground-memory-v1'))).toBeNull();
  await startScenario(page, 'robot');
  await finishUntilPaused(page);
  await expect(lab.locator('.lab-event').filter({ hasText: 'recall_lesson(' })).toHaveCount(0);
  await expect(lab.locator('.lab-event').filter({ hasText: 'repair_brick(' })).toHaveCount(1);
});
