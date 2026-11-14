import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`language selection preserves input and persists at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/status', route => route.fulfill({ json: {
      copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
    } }));
    await page.goto('/');
    await page.locator('#brief').fill('My untranslated model: 🚀');
    const cases = [
      ['de', 'Was bauen wir?', 'Szene ersetzen', 'Planung läuft'],
      ['fr', 'Que construisons-nous ?', 'Remplacer la scène', 'Planification en cours'],
      ['it', 'Cosa costruiamo?', 'Sostituisci la scena', 'Pianificazione in corso'],
      ['es', '¿Qué construimos?', 'Reemplazar escena', 'Planificación en curso'],
      ['pt', 'O que vamos construir?', 'Substituir cena', 'Planejamento em andamento'],
      ['en', 'What shall we build?', 'Replace scene', 'Planning in progress'],
    ];
    for (const [language, briefLabel, destination, planning] of cases) {
      await page.locator('#language').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('label[for="brief"]')).toHaveText(briefLabel);
      await expect(page.locator('.scene-action')).toContainText(destination);
      await expect(page.locator('#planning-title')).toHaveText(planning);
      await expect(page.locator('#brief')).toHaveValue('My untranslated model: 🚀');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await page.locator('#language').selectOption('de');
    await page.reload();
    await expect(page.locator('#language')).toHaveValue('de');
    await expect(page.locator('label[for="brief"]')).toHaveText('Was bauen wir?');
    await expect(page.locator('#language-note')).toContainText('frage auf Englisch');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('language.png') });
  });
}

test('translated planning dialog keeps the measured provider separate', async ({ page }) => {
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
  await page.locator('#language').selectOption('fr');
  await page.locator('#brief').fill('A 500-brick lighthouse');
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const dialog = page.getByRole('dialog', { name: 'Planification en cours' });
  await expect(dialog).toContainText('55–175 secondes');
  await expect(dialog).toContainText('ce n’est pas une échéance');
  await page.locator('#abort-planning').click();
  await expect(page.locator('#notice')).toContainText('Planification annulée');
});

test('translated build state and inspection update without altering the brief', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#language').selectOption('de');
  await page.locator('#tab-tasks').click();
  await expect(page.locator('#task-list')).toContainText('Erstelle einen Plan');
  await page.locator('#tab-live').click();
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  const prompt = 'Build a blue explorer spaceship with wide wings and two engines.';
  await page.locator('#space').click();
  await page.locator('#brief').fill(prompt);
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#stage-status')).toContainText('Plan bereit');
  await expect(page.locator('#checks')).toContainText('Auftrag erfüllt');
  await expect(page.locator('#scene-caption')).toContainText('Bauplan bereit');
  await expect(page.locator('#checks')).toContainText('über Flächen verbunden');
  await page.locator('#tab-tasks').click();
  await expect(page.locator('#task-list')).toContainText('Wartet auf:');
  await expect(page.locator('#task-list')).toContainText('Fahrwerk');
  await page.locator('#tab-live').click();
  await page.locator('#step').click();
  await expect(page.locator('#event-list')).toContainText('Übergabe');
  await expect(page.locator('#brief')).toHaveValue(prompt);
  await page.locator('#language').selectOption('fr');
  await expect(page.locator('#checks')).toContainText('Consigne respectée');
  await expect(page.locator('#brief')).toHaveValue(prompt);
});

test('custom task labels localize without translating object names', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => route.fulfill({ json: { spec: {
    world: 'jurassic', model: 'custom', color: 'green', longTail: false, wideWings: false, budget: 10,
    design: { name: 'External 🚀', objects: [{ name: 'Structure 🚀', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'green', part: 'frame', repeat: { count: 4, dx: 0, dy: 1, dz: 0 } },
    ] }] },
  } } }));
  await page.goto('/');
  await page.locator('#language').selectOption('fr');
  await page.locator('#brief').fill('External 🚀');
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('#tab-tasks').click();
  await expect(page.locator('#task-list')).toContainText('Structure 🚀 · assemblage des supports et détails');
  await page.locator('#tab-live').click();
  await page.locator('#step').click();
  await expect(page.locator('#event-list')).toContainText('Structure 🚀 · structure');
  await expect(page.locator('#brief')).toHaveValue('External 🚀');
});

test('translated guide briefs and crew question buttons work in every language', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  for (const [language, prompt, answer] of [
    ['en', 'green stegosaurus with long tail', 'Feet wait for legs'],
    ['de', 'grünen Stegosaurus mit langem Schwanz', 'Füße warten auf Beine'],
    ['fr', 'stégosaure vert à longue queue', 'Les pieds attendent les jambes'],
    ['it', 'stegosauro verde con coda lunga', 'I piedi aspettano le gambe'],
    ['es', 'estegosaurio verde de cola larga', 'Los pies esperan las piernas'],
    ['pt', 'estegossauro verde de cauda longa', 'Os pés aguardam as pernas'],
  ]) {
    await page.locator('#language').selectOption(language);
    await page.locator('#ask-roles').click();
    for (const agent of ['BuildBot', 'PlanBot', 'FrameBot', 'DetailBot', 'CheckBot'])
      await expect(page.locator('#crew-answer')).toContainText(agent);
    await page.locator('#ask-wait').click();
    await expect(page.locator('#crew-answer')).toContainText(answer);
    await page.locator('#brief').fill(prompt);
    await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
    expect(saved.spec).toMatchObject({ model: 'stegosaurus', color: 'green', longTail: true });
    expect(await page.locator('#brief').inputValue()).toBe(prompt);
  }
});

test('suggested offline briefs are localized and retain their intended designs', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  for (const [language, snippet, model, color] of [
    ['de', 'violetten', 'brachiosaurus', 'purple'],
    ['fr', 'stégosaure orange', 'stegosaurus', 'orange'],
    ['it', 'stegosauro verde', 'stegosaurus', 'green'],
    ['es', 'braquiosaurio morado', 'brachiosaurus', 'purple'],
    ['pt', 'estegossauro laranja', 'stegosaurus', 'orange'],
    ['en', 'green stegosaurus', 'stegosaurus', 'green'],
  ]) {
    await page.locator('#language').selectOption(language);
    await page.locator('#inspire').click();
    await expect(page.locator('#brief')).toHaveValue(new RegExp(snippet));
    await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
    expect(saved.spec).toMatchObject({ model, color });
  }
});

test('local example names use the selected language and survive reload', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#language').selectOption('fr');
  await page.locator('#herd-example').click();
  await expect(page.locator('#brief')).toHaveValue('Exemple local original de troupeau jurassique');
  await page.locator('#tab-tasks').click();
  await expect(page.locator('#task-list')).toContainText('Stégosaure dos-mousse');
  await page.locator('#language').selectOption('de');
  await expect(page.locator('#task-list')).toContainText('Stégosaure dos-mousse');
  await page.reload();
  await expect(page.locator('#brief')).toHaveValue('Exemple local original de troupeau jurassique');
  await page.locator('#tab-tasks').click();
  await expect(page.locator('#task-list')).toContainText('Stégosaure dos-mousse');
});

test('known server status is localized without changing external messages', async ({ page }) => {
  const status = 'Azure planning is off. Server configuration and BRICKLAB_AZURE_AI=1 are required to opt in.';
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: true, sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'external 🚀' },
    azurePlanner: { enabled: false, state: 'off', message: status },
  } }));
  await page.goto('/');
  await page.locator('#language').selectOption('fr');
  await page.locator('#settings').click();
  await expect(page.locator('#planner-status')).toHaveText('external 🚀');
  await expect(page.locator('#azure-planner-status')).toContainText('planification Azure est désactivée');
  await page.locator('#close-dialog').click();
  await expect(page.locator('#language')).toHaveValue('fr');
});

test('compatible planner status follows language changes and preserves external messages', async ({ page }) => {
  const status = 'Compatible AI is configured. Availability and authentication are unverified; only explicit planning sends a prompt.';
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'ready', message: 'external 🚀' },
    compatiblePlanner: { enabled: true, state: 'configured', message: status },
  } }));
  await page.goto('/');
  await page.locator('#settings').click();
  for (const [language, expected] of [['fr', 'L’IA compatible est configurée'], ['de', 'Kompatible KI ist konfiguriert'], ['en', status]]) {
    await page.locator('#language').evaluate((select: HTMLSelectElement, value) => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, language);
    await expect(page.locator('#compatible-planner-status')).toContainText(expected);
    await expect(page.locator('#planner-status')).toHaveText('external 🚀');
  }
});

test('common planning errors are localized in every language without replacing the scene', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => route.fulfill({ status: 429, json: {
    error: 'The coordinator is already planning. Wait for that request to finish.',
  } }));
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await page.locator('#brief').fill('green stegosaurus');
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
  expect(saved).not.toBeNull();
  await page.locator('#settings').click();
  await page.locator('#choose-copilot').click();
  for (const [language, expected] of [
    ['en', 'already planning'], ['de', 'plant bereits'], ['fr', 'planifie déjà'],
    ['it', 'sta già pianificando'], ['es', 'ya está planificando'], ['pt', 'já está planejando'],
  ]) {
    await page.locator('#language').selectOption(language);
    await page.locator('#brief').fill('Original brief');
    await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator('#notice')).toContainText(expected);
    await expect(page.locator('#brief')).toHaveValue('Original brief');
    expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
  }
});

test('invalid saved scenes report localized details without changing the existing build', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await page.locator('#brief').fill('green stegosaurus');
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
  for (const [language, expected] of [
    ['de', 'Herkunft der Szenenergänzungen ist ungültig'],
    ['fr', 'provenance des ajouts à la scène est invalide'],
    ['it', 'provenienza delle aggiunte alla scena non è valida'],
    ['es', 'procedencia de las adiciones a la escena no es válida'],
    ['pt', 'proveniência das adições à cena é inválida'],
  ]) {
    await page.locator('#language').selectOption(language);
    await page.locator('#import-file').setInputFiles({
      name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"sceneAppend":{}}'),
    });
    await expect(page.locator('#notice')).toContainText(expected);
    expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
  }
});

test('translated guide describes template limitations and model consent', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#language').selectOption('fr');
  await page.locator('#guide').click();
  await expect(page.locator('#dialog-body')).toContainText('La planification Copilot est le choix par défaut');
  await expect(page.locator('#dialog-body')).toContainText('Les autres demandes peuvent ne pas modifier ces modèles');
  await expect(page.locator('#dialog-body')).toContainText('budget 500 bricks');
  await page.locator('#close-dialog').click();
  await page.locator('#settings').click();
  await expect(page.locator('#dialog-body')).toContainText('Le coût en dollars est inconnu');
  await expect(page.locator('#dialog-body')).toContainText('La boucle locale seule ne prouve pas');
});

test('guide and planning choices are available in all six languages', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'ready', message: 'external 🚀' },
  } }));
  await page.goto('/');
  for (const [language, guide, settings, mission, privacy, limits] of [
    ['en', 'You’re the director. They’re the crew.', 'Choose how the team plans', 'Mission steps', 'Planning choices and privacy', 'Timing and design limits'],
    ['de', 'Du führst Regie. Sie sind das Team.', 'Wähle die Planung des Teams', 'Missionsschritte', 'Planungsoptionen und Datenschutz', 'Zeit- und Designgrenzen'],
    ['fr', 'Vous dirigez. Ils forment l’équipe.', 'Choisissez le mode de planification', 'Étapes de la mission', 'Options de planification et confidentialité', 'Délais et limites de conception'],
    ['it', 'Tu dirigi. Loro sono la squadra.', 'Scegli come pianifica la squadra', 'Fasi della missione', 'Scelte di pianificazione e privacy', 'Tempi e limiti di progettazione'],
    ['es', 'Tú diriges. Ellos son el equipo.', 'Elige cómo planifica el equipo', 'Pasos de la misión', 'Opciones de planificación y privacidad', 'Tiempos y límites de diseño'],
    ['pt', 'Você dirige. Eles são a equipe.', 'Escolha como a equipe planeja', 'Etapas da missão', 'Opções de planejamento e privacidade', 'Tempo e limites de projeto'],
  ]) {
    await page.locator('#language').selectOption(language);
    await expect(page.getByRole('navigation', { name: mission })).toBeVisible();
    await page.locator('#guide').click();
    await expect(page.locator('#dialog-title')).toHaveText(guide);
    await expect(page.locator('#dialog-body details').nth(0).locator('summary')).toHaveText(privacy);
    await expect(page.locator('#dialog-body details').nth(1).locator('summary')).toHaveText(limits);
    await page.locator('#close-dialog').click();
    await page.locator('#settings').click();
    await expect(page.locator('#dialog-title')).toHaveText(settings);
    await expect(page.locator('#planner-status')).toHaveText('external 🚀');
    await page.locator('#close-dialog').click();
  }
});
