import { test, expect } from '@playwright/test';

test('one planning request offers waiting twice and stops at five minutes', async ({ page }) => {
  await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2024-01-01T00:00:01Z'));
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
    azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Ready' },
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
  await expect(dialog).toContainText('One Azure Foundry request is running. It may take up to 300 seconds.');
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
    return page.locator('#brief').evaluate((input: HTMLTextAreaElement) => { input.value = 'An edit after sending'; })
      .then(() => route.fulfill({ contentType: 'application/x-ndjson', body: `{"type":"waiting"}\n${JSON.stringify({ type: 'result', spec })}\n` }));
  });
  await page.goto('/');
  await page.locator('#brief').fill('The submitted sculpture');
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  await expect(page.locator('#scene-caption')).toContainText('Test sculpture');
  expect(calls).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!).prompt)).toBe('The submitted sculpture');
});

test('one internal design correction is visible and a second invalid result preserves the accepted scene', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: true, sessionKey: 'fixture', copilot: false,
    azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Ready' },
  } }));
  await page.addInitScript(() => {
    const original = window.fetch;
    const state = window as Window & { finishCorrection?: () => void; planCount?: number };
    window.fetch = (input, init) => {
      if (String(input) !== '/api/azure-plan') return original(input, init);
      state.planCount = (state.planCount ?? 0) + 1;
      const encoder = new TextEncoder();
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"waiting"}\n{"type":"correcting"}\n'));
          state.finishCorrection = () => {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error',
              error: 'The design is still invalid after one correction: Custom bricks overlap after expansion. No new build was started. Simplify the brief or reduce scene size before a new submission; no further correction was attempted.',
              designCorrection: { providerAttempts: 2, attempted: true, outcome: 'failed' },
            }) + '\n'));
            controller.close();
          };
        },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use offline templates' }).click();
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await page.getByRole('button', { name: 'Build one step' }).click();
  const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
  await page.getByRole('button', { name: 'Change mode' }).click();
  await expect(page.getByRole('dialog')).toContainText('One submission may use two model requests');
  await page.getByRole('button', { name: 'Use Azure Foundry planning' }).click();
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.getByRole('dialog', { name: 'Planning in progress' })).toContainText('Correcting the generated design once');
  await page.evaluate(() => (window as Window & { finishCorrection?: () => void }).finishCorrection!());
  await expect(page.getByRole('alert')).toContainText('still invalid after one correction');
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
  expect(await page.evaluate(() => (window as Window & { planCount?: number }).planCount)).toBe(1);
});

test('compatible AI is explicit, localized and preserves attribution', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: false, planner: { state: 'off', message: 'Off' },
    compatiblePlanner: { enabled: true, state: 'configured', destination: 'https://provider.example', vision: false,
      message: 'Compatible AI is configured. Availability and authentication are unverified; only explicit planning sends a prompt.' },
  } }));
  await page.route('**/api/compatible-plan', route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ world: 'jurassic', brief: 'A blue beacon', sceneSize: 1000 });
    const spec = { world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
      design: { name: 'Beacon', bricks: [{ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' }] } };
    return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'result', spec })}\n` });
  });
  await page.goto('/');
  await page.locator('#language').selectOption('fr');
  await page.locator('#settings').click();
  await expect(page.locator('#compatible-planner-status')).toContainText('ne sont pas vérifiées');
  await expect(page.locator('#compatible-destination')).toHaveText('https://provider.example');
  await page.locator('#choose-compatible').click();
  expect(calls).toBe(0);
  await page.locator('#brief').fill('A blue beacon');
  await expect(page.locator('#brief-help')).toContainText('service configuré');
  await expect(page.locator('#brief-help')).toContainText('https://provider.example');
  await page.locator('#language').selectOption('de');
  await expect(page.locator('#brief-help')).toContainText('konfigurierten Dienst');
  await expect(page.locator('#brief-help')).toContainText('https://provider.example');
  await page.locator('#language').selectOption('fr');
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#stage-status')).toContainText('Plan prêt');
  expect(calls).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!).source)).toBe('compatible');
});

test('changed compatible destination requires review before sending', async ({ page }) => {
  let destination = 'https://first.example';
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'off', message: 'Off' },
    compatiblePlanner: { enabled: true, state: 'configured', message: 'Ready', destination, vision: false },
  } }));
  await page.route('**/api/compatible-plan', route => { calls++; return route.abort(); });
  await page.goto('/');
  await page.locator('#settings').click();
  await expect(page.locator('#compatible-destination')).toHaveText(destination);
  await page.locator('#choose-compatible').click();
  destination = 'https://second.example';
  await page.locator('#plan').click();
  await expect(page.locator('#notice')).toContainText('destination changed');
  await expect(page.locator('#brief-help')).toContainText(destination);
  expect(calls).toBe(0);
});

test('hosted Azure planning is separate, explicit, and preserves attribution', async ({ page }) => {
  let calls = 0;
  let signIns = 0;
  await page.route('**/api/azure-auth-config', route => {
    signIns++;
    return route.fulfill({ status: 503, json: { error: 'Unexpected visitor sign-in' } });
  });
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: true, sessionKey: 'fixture', copilot: false,
    publicAllowance: { available: true, remaining: 43, limit: 50 },
    azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Fixture Azure planner ready.' },
  } }));
  await page.route('**/api/azure-plan', route => {
    calls++;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ world: 'jurassic', brief: 'A blue beacon', sceneSize: 1000 });
    const spec = { world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
      design: { name: 'Beacon', bricks: [{ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' }] } };
    return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'result', spec })}\n` });
  });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Azure Foundry');
  await expect(page.locator('#brief-help')).toContainText('43 of 50 shared planning attempts remain today');
  expect(calls).toBe(0);
  await page.getByLabel('What shall we build?').fill('A blue beacon');
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  expect(calls).toBe(1);
  expect(signIns).toBe(0);
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

test('explicit planning refreshes a rotated server key without retrying the planning POST', async ({ page }) => {
  let statusCalls = 0;
  let calls = 0;
  await page.route('**/api/status', route => {
    statusCalls++;
    return route.fulfill({ json: {
      hosted: true, sessionKey: statusCalls === 1 ? 'before-restart' : 'after-restart',
      azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Ready' },
    } });
  });
  await page.route('**/api/azure-plan', route => {
    calls++;
    expect(route.request().headers()['x-bricklab-key']).toBe('after-restart');
    return route.fulfill({ status: 503, json: { error: 'Fixture model unavailable.' } });
  });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Azure Foundry');
  expect(statusCalls).toBe(1);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.getByRole('alert')).toHaveText('Fixture model unavailable.');
  expect(calls).toBe(1);
});

test('failed planning-session refresh does not reuse an old key or submit a brief', async ({ page }) => {
  let statusCalls = 0;
  let calls = 0;
  await page.route('**/api/status', route => {
    statusCalls++;
    return statusCalls === 1 ? route.fulfill({ json: {
      hosted: true, sessionKey: 'old-key',
      azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Ready' },
    } }) : route.fulfill({ status: 503, json: { error: 'Fixture status unavailable.' } });
  });
  await page.route('**/api/azure-plan', route => { calls++; return route.abort(); });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Azure Foundry');
  await page.getByRole('button', { name: 'Plan with Azure Foundry' }).click();
  await expect(page.getByRole('alert')).toContainText(/status.*(?:not ready|unavailable)/i);
  expect(calls).toBe(0);
});

test('a configured private Azure planner requires sign-in before submitting', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: false, sessionKey: 'fixture', copilot: false,
    azurePlanner: { enabled: true, state: 'configured', authentication: 'entra', message: 'Fixture Azure planner ready.' },
  } }));
  await page.route('**/api/azure-auth-config', route =>
    route.fulfill({ status: 503, json: { error: 'Fixture sign-in unavailable.' } }));
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
  await expect(page.getByRole('alert')).toContainText('Azure sign-in is not configured. No planning request was sent.');
  expect(calls).toBe(0);
});

for (const [description, status, contentType, body, message] of [
  ['exhausted', 429, 'application/json', JSON.stringify({ error: 'Daily inference budget exhausted.' }), 'Daily inference budget exhausted.'],
  ['unavailable', 200, 'application/x-ndjson', '{"type":"waiting"}\n{"type":"error","error":"Inference budget verification unavailable."}\n', 'Inference budget verification unavailable.'],
] as const) {
  test(`hosted ${description} budget error leaves the current scene unchanged`, async ({ page }) => {
    let calls = 0;
    await page.route('**/api/status', route => route.fulfill({ json: {
      hosted: true, sessionKey: 'fixture', copilot: false,
      azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Fixture Azure planner ready.' },
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
