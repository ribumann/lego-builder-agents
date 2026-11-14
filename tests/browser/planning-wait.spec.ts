import { test, expect } from '@playwright/test';

test('one planning request offers waiting twice and stops at five minutes', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (String(input) !== '/api/plan') return original(input, init);
      (window as Window & { planCount?: number }).planCount = ((window as Window & { planCount?: number }).planCount ?? 0) + 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  const dialog = page.getByRole('dialog', { name: 'Planning in progress' });
  await expect(dialog).toContainText('Estimate unknown; sampled Copilot requests took about 20–183 seconds');
  await page.clock.fastForward(100_000);
  await expect(dialog).toContainText('Elapsed: 100 seconds');
  await dialog.getByRole('button', { name: 'Continue waiting' }).click();
  await expect(dialog.getByRole('button', { name: 'Continue waiting' })).toBeHidden();
  await page.clock.fastForward(100_000);
  await expect(dialog.getByRole('button', { name: 'Continue waiting' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue waiting' }).click();
  await page.clock.fastForward(100_000);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('300-second limit');
  expect(await page.evaluate(() => (window as Window & { planCount?: number }).planCount)).toBe(1);
});

test('planning estimates use only the explicit brief and only the measured provider', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
    azurePlanner: { enabled: true, state: 'configured', message: 'Ready' },
  } }));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => ['/api/plan', '/api/azure-plan'].includes(String(input))
      ? new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }) : original(input, init);
  });
  await page.goto('/');
  await page.getByLabel('What shall we build?').fill('A 500-brick lighthouse');
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  const dialog = page.getByRole('dialog', { name: 'Planning in progress' });
  await expect(dialog).toContainText('For 500 requested bricks, a small Copilot study suggests about 55–175 seconds');
  await expect(dialog).toContainText('not a deadline');
  await dialog.getByRole('button', { name: 'Abort planning' }).click();
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Azure Foundry planning' }).click();
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(dialog).toContainText('Estimate unknown; Azure Foundry was not measured in the Copilot study');
  await expect(dialog).not.toContainText('55–175');
  await dialog.getByRole('button', { name: 'Abort planning' }).click();
});

test('aborting planning leaves the current scene untouched', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => String(input) !== '/api/plan' ? original(input, init)
      : new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Run an offline demo' }).click();
  await page.getByRole('button', { name: 'Pause build' }).click();
  const before = await page.locator('#brick-count').textContent();
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Copilot planning' }).click();
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await page.getByRole('button', { name: 'Abort planning' }).click();
  await expect(page.getByRole('alert')).toContainText('Planning aborted');
  await expect(page.locator('#brick-count')).toHaveText(before!);
});

test('a streamed planning result uses the same single request', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => {
    calls++;
    expect(route.request().headers().accept).toContain('application/x-ndjson');
    const spec = { world: 'jurassic', model: 'custom', color: 'green', longTail: false, wideWings: false, budget: 10,
      design: { name: 'Test sculpture', bricks: [{ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'green', part: 'frame' }] } };
    return route.fulfill({ contentType: 'application/x-ndjson', body: `{"type":"waiting"}\n${JSON.stringify({ type: 'result', spec })}\n` });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  await expect(page.locator('#scene-caption')).toContainText('Test sculpture');
  expect(calls).toBe(1);
});

test('hosted Azure planning is separate, explicit, and preserves attribution', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: true, sessionKey: 'fixture', copilot: false,
    azurePlanner: { enabled: true, state: 'configured', message: 'Fixture Azure planner ready.' },
  } }));
  await page.route('**/api/azure-plan', route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ world: 'jurassic', brief: 'A blue beacon' });
    const spec = { world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
      design: { name: 'Beacon', bricks: [{ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' }] } };
    return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'result', spec })}\n` });
  });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Azure Foundry');
  expect(calls).toBe(0);
  await page.getByLabel('What shall we build?').fill('A blue beacon');
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  expect(calls).toBe(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
  expect(saved.source).toBe('azure');
});

test('unavailable hosted planner never submits and offline templates remain available', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: true, sessionKey: 'fixture', copilot: false,
    azurePlanner: { enabled: false, state: 'off', message: 'Hosted planning is disabled.' },
  } }));
  await page.route('**/api/azure-plan', route => { calls++; return route.abort(); });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Azure Foundry');
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.getByRole('alert')).toContainText('Hosted planning is disabled');
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use offline templates' }).click();
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  expect(calls).toBe(0);
});

test('a configured local Azure planner is an explicit separate choice', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: false, sessionKey: 'fixture', copilot: false,
    azurePlanner: { enabled: true, state: 'configured', message: 'Fixture Azure planner ready.' },
  } }));
  await page.route('**/api/azure-plan', route => {
    calls++;
    return route.fulfill({ status: 503, json: { error: 'Fixture unavailable.' } });
  });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Copilot');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Azure Foundry planning' }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture unavailable');
  expect(calls).toBe(1);
});

for (const [description, status, contentType, body, message] of [
  ['exhausted', 429, 'application/json', JSON.stringify({ error: 'Daily inference budget exhausted.' }), 'Daily inference budget exhausted.'],
  ['unavailable', 200, 'application/x-ndjson', '{"type":"waiting"}\n{"type":"error","error":"Inference budget verification unavailable."}\n', 'Inference budget verification unavailable.'],
] as const) {
  test(`hosted ${description} budget error leaves the current scene unchanged`, async ({ page }) => {
    let calls = 0;
    await page.route('**/api/status', route => route.fulfill({ json: {
      hosted: true, sessionKey: 'fixture', copilot: false,
      azurePlanner: { enabled: true, state: 'configured', message: 'Fixture Azure planner ready.' },
    } }));
    await page.route('**/api/azure-plan', route => {
      calls++;
      return route.fulfill({ status, contentType, body });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Change mode' }).click();
    await page.getByRole('button', { name: 'Use offline templates' }).click();
    await page.getByRole('button', { name: 'Make a plan' }).click();
    await page.getByRole('button', { name: 'Build one step' }).click();
    const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
    await page.getByRole('button', { name: 'Change mode' }).click();
    await page.getByRole('button', { name: 'Use Azure Foundry planning' }).click();
    await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
    await expect(page.getByRole('alert')).toHaveText(message);
    expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
    expect(calls).toBe(1);
  });
}
