import { test, expect, type Page } from '@playwright/test';
import { Team, allBricks, createPlan, parseBrief, validateSpec } from '../../src/engine';

async function chooseOfflineTemplates(page: Page) {
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use offline templates' }).click();
}

test('Jurassic build supports pause, step, repair, replay, download and restore', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await chooseOfflineTemplates(page);
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
  await chooseOfflineTemplates(page);
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
  await expect(page.locator('.agent-name strong')).toHaveText(['BuildBot', 'PlanBot', 'FrameBot', 'DetailBot', 'CheckBot']);
  await expect(page.locator('.agent-name small')).toHaveText(['Coordinator', 'Plan verifier', 'Structure specialist', 'Finishing specialist', 'Quality inspector']);
  for (const role of await page.locator('.agent-name small').all()) await expect(role).toBeVisible();
  expect(await page.locator('.stage + .transport + .team-panel').count()).toBe(1);
  const quiz = await page.locator('#quiz-options').boundingBox();
  const files = await page.locator('.file-actions').boundingBox();
  expect(quiz).not.toBeNull();
  expect(files).not.toBeNull();
  expect(files!.y).toBeGreaterThanOrEqual(quiz!.y + quiz!.height);
  await page.getByRole('button', { name: 'Run an offline demo' }).click();
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
  await expect(page.locator('#event-list')).toContainText('PlanBot');
  await expect(page.locator('#plan-state')).toHaveText('Reviewed');
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  await expect(page.getByLabel('What shall we build?')).toHaveValue('red explorer with wide wings');
  await page.getByLabel('Fast-forward speed, currently 1 times').click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(page.locator('#inspection-result')).toHaveText('4/4 checks', { timeout: 15_000 });
  await expect(page.locator('#event-list')).toContainText('CheckBot');
  await expect(page.locator('#check-state')).toHaveText('Passed');
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
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.getByRole('alert')).toContainText('Copilot unavailable');
  await expect(page.locator('#stage-status')).toContainText('Ready for your imagination');
  await expect(page.getByRole('button', { name: 'Start building' })).toBeDisabled();
});

test('cloud is default but unavailable setup never submits or falls back to templates', async ({ page }) => {
  let requests = 0;
  let localRequests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: false, sessionKey: 'fixture',
    planner: { state: 'off', message: 'Run copilot login and restart with BRICKLAB_COPILOT=1.' },
  } }));
  await page.route('**/api/plan', route => { requests++; return route.abort(); });
  await page.route('**/api/local-plan', route => { localRequests++; return route.abort(); });
  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Copilot cloud planning');
  await expect(page.getByRole('alert')).toContainText('BRICKLAB_COPILOT=1');
  await page.getByLabel('What shall we build?').fill('An original kinetic sculpture with a canopy.');
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.getByRole('alert')).toContainText('copilot login');
  await expect(page.getByRole('button', { name: 'Start building' })).toBeDisabled();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Local AI', exact: true }).click();
  await page.getByRole('button', { name: 'Plan with Local AI', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('BRICKLAB_LOCAL_AI=1');
  expect(localRequests).toBe(0);
  await chooseOfflineTemplates(page);
  await page.getByLabel('What shall we build?').fill('Build a green stegosaurus with a long tail.');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.locator('#stage-status')).toContainText('Plan ready');
  expect(requests).toBe(0);
});

test('cloud template output is rejected without a new build or retry', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Fixture planner ready.' },
  } }));
  await page.route('**/api/plan', route => {
    requests++;
    return route.fulfill({ json: { spec: parseBrief('jurassic', 'Build a green stegosaurus.').spec } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await expect(page.locator('#planner-status')).toHaveText('Fixture planner ready.');
  await page.getByRole('button', { name: 'Use Copilot planning' }).click();
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.getByRole('alert')).toContainText('template instead of custom geometry');
  await expect(page.locator('#stage-status')).toContainText('Ready for your imagination');
  await expect(page.getByRole('button', { name: 'Start building' })).toBeDisabled();
  expect(requests).toBe(1);
});

test('explicit Local AI sends only to its endpoint, restores attribution and reports failure', async ({ page }) => {
  const briefs: string[] = [];
  let cloudRequests = 0;
  let unavailable = false;
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: false, sessionKey: 'fixture', planner: { state: 'off', message: 'Copilot off.' },
    localPlanner: { enabled: true, state: 'configured', message: 'Fixture local model configured.' },
  } }));
  await page.route('**/api/plan', route => { cloudRequests++; return route.abort(); });
  await page.route('**/api/local-plan', route => {
    briefs.push(route.request().postDataJSON().brief);
    return unavailable ? route.fulfill({ status: 502, json: { error: 'Local model missing. Configure Ollama on the server host.' } })
      : route.fulfill({ json: { spec: {
        world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
        design: { name: 'Local original fixture', objects: [{ name: 'Sculpture', bricks: [
          { x: 0, y: 0, z: 0, width: 2, height: 2, depth: 2, color: 'purple', part: 'frame' },
        ] }] },
      } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await expect(page.locator('#local-planner-status')).toHaveText('Fixture local model configured.');
  await page.getByRole('button', { name: 'Use Local AI', exact: true }).click();
  expect(briefs).toHaveLength(0);
  const brief = 'An original purple sculpture, not a dinosaur or spaceship.';
  await page.getByLabel('What shall we build?').fill(brief);
  await page.getByRole('button', { name: 'Plan with Local AI', exact: true }).click();
  await expect(page.locator('#scene-caption')).toContainText('Local original fixture');
  expect(briefs).toEqual([brief]);
  expect(cloudRequests).toBe(0);
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!).source)).toBe('local-ai');
  await page.reload();
  await expect(page.locator('#stage-status')).toContainText('Mission complete');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await page.getByRole('button', { name: 'Use Local AI', exact: true }).click();
  unavailable = true;
  await page.getByRole('button', { name: 'Plan with Local AI', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Local model missing');
  await expect(page.locator('#brick-count')).toHaveText('1 / 1 bricks');
  expect(briefs).toHaveLength(2);
  expect(cloudRequests).toBe(0);
});

test('fixture Copilot custom design accepts an unrelated brief and survives reload', async ({ page }) => {
  const sent: string[] = [];
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: false, sessionKey: 'fixture', planner: { state: 'needs-auth', message: '<login> required; retry after login' },
  } }));
  await page.route('**/api/plan', async route => {
    sent.push(route.request().postDataJSON().brief);
    await route.fulfill({ json: { spec: {
      world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
      design: { name: 'Lighthouse fixture', bricks: [
        { x: 0, y: 0, z: 0, width: 3, height: 1, depth: 3, color: 'blue', part: 'frame' },
        { x: 1, y: 1, z: 1, width: 1, height: 4, depth: 1, color: 'white', part: 'frame' },
        { x: 1, y: 5, z: 1, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
      ] },
    } } });
  });

  await page.goto('/');
  await expect(page.locator('#mode-label')).toContainText('Copilot cloud planning');
  await expect(page.locator('#brief-help')).toContainText('may consume quota');
  await page.getByRole('button', { name: 'Change mode' }).click();
  await expect(page.locator('#planner-status')).toHaveText('<login> required; retry after login');
  await expect(page.locator('#planner-status login')).toHaveCount(0);
  expect(sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Use Copilot planning' }).click();
  await page.getByLabel('What shall we build?').fill('A lighthouse on a rocky coast');
  await page.getByRole('button', { name: 'Send brief to Copilot' }).click();
  await expect(page.locator('#scene-caption')).toContainText('Lighthouse fixture');
  expect(sent).toEqual(['A lighthouse on a rocky coast']);
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 20_000 });
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
  await page.getByRole('button', { name: 'Hide one brick' }).click();
  await page.getByRole('button', { name: 'Ask team to repair' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 20_000 });
  await page.reload();
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
  await expect(page.getByLabel('What shall we build?')).toHaveValue('A lighthouse on a rocky coast');
});

test('single-step preserves a failed inspection for a disconnected custom design', async ({ page }) => {
  const team = new Team(createPlan(validateSpec({
    world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
    design: { name: 'Two islands fixture', bricks: [
      { x: 0, y: 0, z: 0, width: 2, height: 1, depth: 1, color: 'blue', part: 'frame' },
      { x: 5, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' },
    ] },
  }, 'jurassic')));
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({
    name: 'disconnected.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(team.snapshot('Two separate islands'))),
  });
  await page.getByRole('button', { name: 'Build one step' }).click();
  await expect(page.locator('#brick-count')).toHaveText('1 / 2 bricks');
  await expect(page.locator('#stage-status')).toContainText('Paused');
  await page.getByRole('button', { name: 'Build one step' }).click();
  await expect(page.locator('#brick-count')).toHaveText('2 / 2 bricks');
  await expect(page.locator('#inspection-result')).toHaveText('2/3 checks');
  await expect(page.locator('#check-state')).toHaveText('Problem found');
  await expect(page.getByRole('button', { name: 'Continue build' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Build one step' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ask team to repair' }).click();
  await expect(page.locator('#event-list')).toContainText('cannot automatically repair a different topology problem');
  await expect(page.locator('#check-state')).toHaveText('Problem found');
  await page.reload();
  await expect(page.locator('#check-state')).toHaveText('Problem found');
  await expect(page.getByRole('button', { name: 'Continue build' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ask team to repair' })).toBeEnabled();
});

test('local herd world builds named objects, repairs and survives reload without a model', async ({ page }) => {
  test.setTimeout(120_000);
  let requests = 0;
  await page.route('**/api/plan', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load local Jurassic herd' }).click();
  await expect(page.getByRole('alert')).toContainText('not a live model result');
  await expect(page.locator('#scene-caption')).toContainText('Jurassic herd');
  await page.getByRole('button', { name: 'Task board' }).click();
  await expect(page.locator('#task-list')).toContainText('Mossback stegosaurus');
  await expect(page.locator('#task-list')).toContainText('Violet brachiosaurus');
  await expect(page.locator('#task-list')).toContainText('Valley tree');
  await expect(page.locator('#plan-state')).toHaveText('Reviewed');
  await page.getByLabel('Fast-forward speed, currently 1 times').click();
  await page.getByLabel('Fast-forward speed, currently 4 times').click();
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 90_000 });
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
  await expect(page.locator('#checks')).toContainText('Mossback stegosaurus');
  await expect(page.locator('#checks')).toContainText('Violet brachiosaurus');
  await expect(page.locator('#check-state')).toHaveText('Passed');
  await page.getByRole('button', { name: 'Hide one brick' }).click();
  await expect(page.locator('#check-state')).toHaveText('Problem found');
  await page.getByRole('button', { name: 'Ask team to repair' }).click();
  await expect(page.locator('#stage-status')).toContainText('Mission complete', { timeout: 20_000 });
  await page.getByLabel('Replay placed bricks').fill('20');
  await expect(page.locator('#replay-label')).toContainText('20 /');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.reload();
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
  await expect(page.getByLabel('What shall we build?')).toHaveValue('Original local Jurassic herd example');
  expect(requests).toBe(0);
});

test('completed advanced synthetic world renders at the occupied-cell limit', async ({ page }) => {
  test.setTimeout(120_000);
  const rows = Array.from({ length: 64 }, (_, i) => ({
    x: -32, y: Math.floor(i / 8) * 8, z: -32 + (i % 8) * 8,
    width: 8, height: 8, depth: 8, color: 'blue', part: 'frame',
    repeat: { count: 8, dx: 8, dy: 0, dz: 0 },
  }));
  const spec = validateSpec({ world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 8192,
    design: { name: 'Advanced synthetic world', objects: [{ name: 'Advanced test object', bricks: rows }] } }, 'space');
  const plan = createPlan(spec);
  const team = new Team(plan);
  const bricks = allBricks(plan);
  expect(bricks).toHaveLength(512);
  expect(bricks.reduce((sum, b) => sum + b.width! * b.height! * b.depth!, 0)).toBe(262144);
  for (const brick of bricks) team.bricks.set(brick.id, brick);
  team.status = 'complete';
  let requests = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/plan', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({
    name: 'advanced-synthetic.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(team.snapshot('Advanced synthetic test world'))),
  });
  await expect(page.locator('#scene-error')).toBeHidden();
  await expect(page.locator('#brick-count')).toContainText('512 / 512');
  await expect(page.locator('#inspection-result')).toHaveText('3/3 checks');
  await expect(page.locator('#checks')).toContainText('Advanced test object');
  await page.getByRole('button', { name: 'Task board' }).click();
  await expect(page.locator('#task-list')).toContainText('Advanced test object');
  const canvas = page.locator('#canvas-host canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-model-bodies', '512', { timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-model-studs', '8192');
  expect(Number(await canvas.getAttribute('data-render-calls'))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute('data-render-triangles'))).toBeGreaterThan(0);
  const webgl = await canvas.evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    return gl && { error: gl.getError(), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
  });
  expect(webgl).toBeTruthy();
  expect(webgl!.error).toBe(0);
  expect(webgl!.width).toBeGreaterThan(0);
  expect(webgl!.height).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('dialog')).toContainText('Decorative studs are sampled above 8,192 per model or blueprint; all brick bodies remain present and selectable.');
  await expect(page.getByRole('dialog')).toContainText('262,144 cells');
  expect(requests).toBe(0);
  expect(errors).toEqual([]);
});
