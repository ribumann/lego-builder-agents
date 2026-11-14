import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const image = resolve('tests', 'fixtures', 'vision-fixture.jpg');

test('pagehide during image preparation prevents a later planning request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', localPlanner: { enabled: true, state: 'configured', message: 'Ready' },
  } }));
  await page.route('**/api/local-plan', route => {
    requests++;
    return route.fulfill({ status: 503, json: { error: 'Must not be reached.' } });
  });
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      document.documentElement.dataset.imageReading = 'true';
      return new Promise<ArrayBuffer>(resolve => {
        window.addEventListener('release-image-read', () => { void original.call(this).then(resolve); }, { once: true });
      });
    };
  });
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await page.locator('#plan').click();
  const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
  await page.locator('#settings').click();
  await page.locator('#choose-local-ai').click();
  await page.locator('#image-title').click();
  await page.locator('#image-file').setInputFiles(image);
  await page.locator('#image-consent').check();
  await page.locator('#plan').click();
  await expect(page.locator('html')).toHaveAttribute('data-image-reading', 'true');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('release-image-read'));
  });
  await expect(page.locator('#notice')).toContainText('Planning aborted');
  await expect(page.locator('#planning-dialog')).not.toBeVisible();
  await expect(page.locator('#plan')).toBeEnabled();
  expect(requests).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
});

test('image selection requires explicit consent and sends only on planning', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', localPlanner: { enabled: true, state: 'configured', message: 'Ready' },
  } }));
  await page.route('**/api/local-plan', route => {
    requests++;
    const body = route.request().postDataJSON();
    expect(body.imageConsent).toBe(true);
    expect(body.hollowInterior).toBe(true);
    expect(body.image.mimeType).toBe('image/jpeg');
    expect(body.image.data.length).toBeGreaterThan(0);
    return route.fulfill({ status: 503, json: { error: 'Fixture unavailable.' } });
  });
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local-ai').click();
  await page.locator('#hollow-interior').check();
  await page.locator('#image-title').click();
  await expect(page.locator('#image-disclosure')).toContainText('metadata');
  await expect(page.locator('#image-destination')).toContainText('Ollama');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#image-choose').click();
  await (await chooser).setFiles(image);
  expect(requests).toBe(0);
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#notice')).toContainText('Consent');
  expect(requests).toBe(0);
  await page.locator('#image-consent').check();
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#notice')).toContainText('Fixture unavailable');
  expect(requests).toBe(1);
  await expect(page.locator('#image-consent')).not.toBeChecked();
});

test('hosted and offline routes do not send selected images', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    hosted: true, sessionKey: 'fixture', azurePlanner: { enabled: true, state: 'configured', message: 'Ready' },
  } }));
  await page.route('**/api/azure-plan', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.locator('#image-title').click();
  await page.locator('#image-file').setInputFiles(image);
  await page.locator('#image-consent').check();
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#notice')).toContainText('unavailable');
  expect(requests).toBe(0);
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await expect(page.locator('#image-consent')).not.toBeChecked();
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#notice')).toContainText('unavailable');
  expect(requests).toBe(0);
});

test('Copilot image planning stays unavailable without verified process containment', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/plan', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.locator('#image-title').click();
  await expect(page.locator('#image-destination')).toContainText('unavailable');
  await page.locator('#image-file').setInputFiles(image);
  await page.locator('#image-consent').check();
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#notice')).toContainText('unavailable');
  expect(requests).toBe(0);
});

test('image disclosure and destination change with language and planner', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', copilot: true, planner: { state: 'ready', message: 'Ready' },
    localPlanner: { enabled: true, state: 'configured', message: 'Ready' },
  } }));
  await page.goto('/');
  await page.locator('#image-title').click();
  await page.locator('#image-file').setInputFiles(image);
  await page.locator('#image-consent').check();
  await page.locator('#language').selectOption('de');
  await expect(page.locator('#image-disclosure')).toContainText('Metadaten');
  await page.locator('#settings').click();
  await page.locator('#choose-local-ai').click();
  await expect(page.locator('#image-destination')).toContainText('Ollama');
  await expect(page.locator('#image-consent')).not.toBeChecked();
});

test('image privacy disclosure is available in all six languages', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'off', message: 'Off' },
  } }));
  await page.goto('/');
  await page.locator('#image-title').click();
  for (const [language, metadata] of [
    ['en', 'metadata'], ['de', 'Metadaten'], ['fr', 'métadonnées'],
    ['it', 'metadati'], ['es', 'metadatos'], ['pt', 'metadados'],
  ]) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('#image-disclosure')).toContainText(metadata);
  }
});

test('aborting local vision planning preserves the existing scene', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', localPlanner: { enabled: true, state: 'configured', message: 'Ready' },
  } }));
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    window.fetch = (input, init) => String(input) !== '/api/local-plan' ? fetchOriginal(input, init)
      : new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
  });
  await page.goto('/');
  await page.locator('#settings').click();
  await page.locator('#choose-local').click();
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const saved = await page.evaluate(() => localStorage.getItem('bricklab-jurassic'));
  await page.locator('#settings').click();
  await page.locator('#choose-local-ai').click();
  await page.locator('#image-title').click();
  await page.locator('#image-file').setInputFiles(image);
  await page.locator('#image-consent').check();
  await page.locator('#brief-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('#abort-planning').click();
  await expect(page.locator('#notice')).toContainText('Planning aborted');
  expect(await page.evaluate(() => localStorage.getItem('bricklab-jurassic'))).toBe(saved);
});
