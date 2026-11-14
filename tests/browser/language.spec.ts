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
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  const prompt = 'Build a blue explorer spaceship with wide wings and two engines.';
  await page.locator('#space').click();
  await page.locator('#brief').fill(prompt);
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#stage-status')).toContainText('Plan bereit');
  await expect(page.locator('#checks')).toContainText('Auftrag erfüllt');
  await page.locator('#step').click();
  await expect(page.locator('#event-list')).toContainText('Übergabe');
  await expect(page.locator('#brief')).toHaveValue(prompt);
  await page.locator('#language').selectOption('fr');
  await expect(page.locator('#checks')).toContainText('Consigne respectée');
  await expect(page.locator('#brief')).toHaveValue(prompt);
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
    await page.locator('#ask-wait').click();
    await expect(page.locator('#crew-answer')).toContainText(answer);
    await page.locator('#brief').fill(prompt);
    await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bricklab-jurassic')!));
    expect(saved.spec).toMatchObject({ model: 'stegosaurus', color: 'green', longTail: true });
    expect(await page.locator('#brief').inputValue()).toBe(prompt);
  }
});
