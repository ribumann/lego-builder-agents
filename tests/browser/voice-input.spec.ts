import { test, expect, type Page } from '@playwright/test';

type VoiceCalls = { microphone: number; tracksStopped: number; workers: number };

declare global {
  interface Window {
    __voiceCalls: VoiceCalls;
    __mockTranscript: string;
    __denyMicrophone: boolean;
  }
}

async function prepareVoicePage(page: Page, open = true, hosted = false) {
  const modelRequests: string[] = [];
  const planRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname.includes('huggingface.co') || url.hostname.endsWith('hf.co')) modelRequests.push(url.href);
    if (url.pathname === '/api/plan' || url.pathname === '/api/azure-plan') planRequests.push(url.href);
  });
  await page.addInitScript(() => {
    const calls: VoiceCalls = { microphone: 0, tracksStopped: 0, workers: 0 };
    Object.defineProperty(window, '__voiceCalls', { configurable: true, value: calls });
    window.__mockTranscript = 'A blue dinosaur with a gold crest';
    window.__denyMicrophone = false;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          calls.microphone++;
          if (window.__denyMicrophone) throw new DOMException('Denied', 'NotAllowedError');
          return { getTracks: () => [{ stop: () => { calls.tracksStopped++; } }] };
        },
      },
    });
    class MockRecorder {
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['mock audio']) } as BlobEvent);
          this.onstop?.();
        }, 0);
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: MockRecorder });
    class MockAudioContext {
      async decodeAudioData() { return { length: 1, duration: 1 } as unknown as AudioBuffer; }
      async close() {}
    }
    class MockOfflineAudioContext {
      destination = {};
      constructor(_channels: number, _frames: number, _rate: number) {}
      createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
      async startRendering() { return { getChannelData: () => new Float32Array([0.1]) } as unknown as AudioBuffer; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: MockAudioContext });
    Object.defineProperty(window, 'OfflineAudioContext', { configurable: true, writable: true, value: MockOfflineAudioContext });
    class MockWorker {
      onmessage: ((event: MessageEvent<{ text: string }>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: URL, _options: WorkerOptions) {}
      postMessage() {
        calls.workers++;
        setTimeout(() => this.onmessage?.({ data: { text: window.__mockTranscript } } as MessageEvent<{ text: string }>), 0);
      }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: MockWorker });
  });
  await page.route('**/api/status', route => route.fulfill({ json: hosted ? {
    hosted: true, azureImages: true, sessionKey: 'voice-fixture',
    azurePlanner: { enabled: true, state: 'configured', authentication: 'anonymous', message: 'Ready' },
    publicAllowance: { available: true, day: '2026-04-04', used: 1, limit: 50, remaining: 49 },
  } : {
    copilot: true, sessionKey: 'voice-fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  if (open) await page.locator('#voice-entry').click();
  return { modelRequests, planRequests };
}

for (const width of [1440, 390]) {
  test(`compact composer keeps media conditional and keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { modelRequests, planRequests } = await prepareVoicePage(page, false);
    await expect(page.locator('#voice-panel')).toBeHidden();
    await expect(page.locator('#image-chip')).toBeHidden();
    await expect(page.locator('#media-privacy')).not.toHaveAttribute('open', '');
    const attach = await page.locator('#image-choose').boundingBox();
    const brief = await page.locator('#brief').boundingBox();
    const mic = await page.locator('#voice-entry').boundingBox();
    expect(attach!.x + attach!.width).toBeLessThanOrEqual(brief!.x);
    expect(brief!.x + brief!.width).toBeLessThanOrEqual(mic!.x);
    expect(Math.abs(attach!.y - mic!.y)).toBeLessThan(1);
    await page.locator('#image-file').setInputFiles('tests/fixtures/vision-fixture.jpg');
    await expect(page.locator('#image-chip')).toBeVisible();
    await expect(page.locator('#image-name')).toHaveText('vision-fixture.jpg');
    await expect(page.locator('#image-permission')).toBeVisible();
    await page.locator('#image-remove').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#image-chip')).toBeHidden();
    await expect(page.locator('#image-choose')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#brief')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#voice-entry')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#voice-start')).toBeFocused();
    expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);
    await page.locator('#voice-cancel').click();
    await expect(page.locator('#voice-panel')).toBeHidden();
    await expect(page.locator('#voice-entry')).toBeFocused();
    for (const language of ['en', 'de', 'fr', 'it', 'es', 'pt']) {
      await page.locator('#language').selectOption(language);
      await expect(page.locator('#image-choose')).toHaveAccessibleName(/\S/);
      await expect(page.locator('#voice-entry')).toHaveAccessibleName(/\S/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    expect(modelRequests).toEqual([]);
    expect(planRequests).toEqual([]);
  });
}

test('discloses voice processing before permission and keeps transcript separate until explicit apply', async ({ page }) => {
  const { modelRequests, planRequests } = await prepareVoicePage(page, false);
  await expect(page.locator('#voice-panel')).toBeHidden();
  await expect(page.locator('#voice-disclosure')).toBeHidden();
  await page.locator('#media-privacy > summary').click();
  await expect(page.locator('#voice-disclosure')).toBeVisible();
  await expect(page.locator('#voice-disclosure')).toContainText('45 MB');
  await expect(page.locator('#voice-disclosure')).toContainText('IP address');
  await expect(page.locator('#voice-disclosure')).toContainText('browser cache');
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);
  expect(modelRequests).toEqual([]);
  expect(planRequests).toEqual([]);

  await page.locator('#media-privacy > summary').click();
  await page.locator('#voice-entry').click();
  await expect(page.locator('#voice-permission')).toContainText('45 MB');
  await expect(page.locator('#voice-permission')).toContainText('IP address');
  await expect(page.locator('#voice-review')).toBeHidden();
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);
  await page.locator('#brief').fill('Typed during recording');
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Recording');
  await expect(page.locator('#voice-start')).toBeDisabled();
  await expect(page.locator('#voice-stop')).toBeEnabled();
  await expect(page.locator('#voice-cancel')).toBeEnabled();
  await expect(page.locator('#voice-entry')).toHaveAccessibleName('Stop and transcribe');
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(1);
  await page.locator('#brief').fill('Changed while recording');
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-transcript')).toHaveValue('A blue dinosaur with a gold crest');
  await expect(page.locator('#brief')).toHaveValue('Changed while recording');
  await expect(page.locator('#voice-apply')).toBeEnabled();
  expect(await page.evaluate(() => window.__voiceCalls.tracksStopped)).toBe(1);
  expect(await page.evaluate(() => window.__voiceCalls.workers)).toBe(1);
  expect(modelRequests).toEqual([]);
  expect(planRequests).toEqual([]);
  await expect(page.locator('#notice')).toBeHidden();

  await page.locator('#voice-apply').click();
  await expect(page.locator('#voice-panel')).toBeHidden();
  await expect(page.locator('#brief')).toBeFocused();
  await expect(page.locator('#brief')).toHaveValue('A blue dinosaur with a gold crest');
  expect(modelRequests).toEqual([]);
  expect(planRequests).toEqual([]);

  await page.locator('#voice-entry').click();
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Recording');
  await page.locator('#voice-cancel').click();
  await expect(page.locator('#voice-status')).toHaveText('Ready for voice input');
  await expect(page.locator('#brief')).toHaveValue('A blue dinosaur with a gold crest');
  await expect(page.locator('#voice-transcript')).toHaveValue('A blue dinosaur with a gold crest');
});

test('preserves transcript edits made while recording and requires review before replacing them', async ({ page }) => {
  await prepareVoicePage(page);
  await page.locator('#voice-start').click();
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-transcript')).toBeVisible();
  await page.locator('#voice-transcript').fill('My existing edited transcript');
  await page.locator('#voice-start').click();
  await page.locator('#voice-transcript').fill('An edit made during recording');
  await expect(page.locator('#voice-apply')).toBeDisabled();
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-pending')).toBeVisible();
  await expect(page.locator('#voice-pending-text')).toHaveText('A blue dinosaur with a gold crest');
  await expect(page.locator('#voice-transcript')).toHaveValue('An edit made during recording');
  await expect(page.locator('#voice-start')).toBeDisabled();

  await page.locator('#voice-use-pending').click();
  await expect(page.locator('#voice-transcript')).toHaveValue('A blue dinosaur with a gold crest');
  await expect(page.locator('#voice-pending')).toBeHidden();
  await expect(page.locator('#brief')).not.toHaveValue('A blue dinosaur with a gold crest');
});

test('never replaces an existing transcript without explicit action and can discard a suggestion', async ({ page }) => {
  await prepareVoicePage(page);
  await page.locator('#voice-start').click();
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-transcript')).toBeVisible();
  await page.locator('#voice-transcript').fill('My edited transcript');
  await page.locator('#voice-start').click();
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-pending-text')).toHaveText('A blue dinosaur with a gold crest');
  await expect(page.locator('#voice-transcript')).toHaveValue('My edited transcript');
  await page.locator('#voice-discard-pending').click();
  await expect(page.locator('#voice-pending')).toBeHidden();
  await expect(page.locator('#voice-transcript')).toHaveValue('My edited transcript');
  await expect(page.locator('#voice-start')).toBeEnabled();
});

test('hosted planning sends only the reviewed voice brief and consented image to the anonymous Azure route', async ({ page }) => {
  const { modelRequests, planRequests } = await prepareVoicePage(page, false, true);
  let submitted: Record<string, unknown> | undefined;
  let requestHeaders: Record<string, string> | undefined;
  await page.route('**/api/azure-plan', route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    requestHeaders = route.request().headers();
    return new Promise<void>(resolve => setTimeout(() => resolve(), 300)).then(() =>
      route.fulfill({ status: 400, json: { error: 'Mocked hosted validation response.' } }));
  });

  await expect(page.locator('#mode-label')).toContainText('Azure Foundry');
  await expect(page.locator('#brief-help')).toContainText('review and apply');
  await expect(page.locator('#brief-help')).toContainText('image consent');
  await expect(page.locator('#brief-help')).toContainText('49 of 50');
  await page.locator('#settings').click();
  await expect(page.locator('#dialog-body')).not.toContainText('GitHub Copilot cloud planner');
  await expect(page.locator('#dialog-body')).not.toContainText('Local AI (Ollama)');
  await expect(page.locator('#dialog-body')).toContainText('No visitor sign-in is required');
  await page.locator('#close-dialog').click();

  const voiceCopy = [
    'Only text you review and apply to the brief',
    'Audio und Transkript bleiben auf diesem Gerät',
    'L’audio et la transcription restent sur cet appareil',
    'L’audio e la trascrizione restano su questo dispositivo',
    'El audio y la transcripción permanecen en este dispositivo',
    'O áudio e a transcrição ficam neste dispositivo',
  ];
  for (const [index, language] of ['en', 'de', 'fr', 'it', 'es', 'pt'].entries()) {
    await page.locator('#language').selectOption(language);
    await page.locator('#voice-entry').click();
    await expect(page.locator('#voice-permission')).toContainText(voiceCopy[index]);
    await page.locator('#voice-cancel').click();
  }
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#voice-entry')).toHaveAccessibleName(/\S/);
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);

  await page.locator('#voice-entry').click();
  await expect(page.locator('#voice-permission')).toContainText('Only text you review and apply');
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Recording');
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-transcript')).toHaveValue('A blue dinosaur with a gold crest');
  await expect(page.locator('#brief')).not.toHaveValue('A blue dinosaur with a gold crest');
  expect(planRequests).toEqual([]);
  await page.locator('#voice-transcript').fill('Build a blue dinosaur with a gold crest.');
  await page.locator('#voice-apply').click();
  await expect(page.locator('#brief')).toHaveValue('Build a blue dinosaur with a gold crest.');
  expect(planRequests).toEqual([]);

  await page.locator('#media-privacy > summary').click();
  await page.locator('#image-file').setInputFiles('tests/fixtures/vision-fixture.jpg');
  await expect(page.locator('#image-destination')).toContainText('Azure Foundry');
  await expect(page.locator('#image-disclosure')).toContainText('metadata');
  const consentCopy = [
    'I consent to send this image',
    'Ich stimme zu, dieses Bild',
    'J’accepte d’envoyer cette image',
    'Acconsento a inviare immagine',
    'Acepto enviar esta imagen',
    'Concordo em enviar esta imagem',
  ];
  for (const [index, language] of ['en', 'de', 'fr', 'it', 'es', 'pt'].entries()) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('#image-destination')).toContainText('Azure Foundry');
    await expect(page.locator('#image-consent-text')).toContainText(consentCopy[index]);
  }
  await page.locator('#language').selectOption('en');
  await page.locator('#plan').click();
  await expect(page.locator('#notice')).toContainText('Consent');
  expect(planRequests).toEqual([]);
  await page.locator('#image-consent').check();
  await page.locator('#plan').click();
  await expect(page.locator('#planning-description')).toHaveText('One Azure Foundry request is running. It may take up to 300 seconds.');
  await expect(page.locator('#planning-description')).not.toContainText('estimate');
  await expect(page.locator('#notice')).toContainText('Mocked hosted validation response');
  expect(planRequests).toHaveLength(1);
  expect(submitted).toMatchObject({
    world: 'jurassic',
    brief: 'Build a blue dinosaur with a gold crest.',
    imageConsent: true,
    image: { mimeType: 'image/jpeg' },
  });
  expect((submitted!.image as { data: string }).data.length).toBeGreaterThan(0);
  expect(submitted).not.toHaveProperty('audio');
  expect(requestHeaders?.['x-bricklab-key']).toBe('voice-fixture');
  expect(requestHeaders?.authorization).toBeUndefined();
  expect(modelRequests).toEqual([]);
});

test('does not silently truncate overlong transcripts or apply them to the brief', async ({ page }) => {
  await prepareVoicePage(page);
  await page.evaluate(() => { window.__mockTranscript = 'x'.repeat(1001); });
  await page.locator('#brief').fill('Keep this brief');
  await page.locator('#voice-start').click();
  await page.locator('#voice-stop').click();
  await expect(page.locator('#voice-transcript')).toHaveValue('x'.repeat(1001));
  await expect(page.locator('#voice-length-warning')).toContainText('1001');
  await expect(page.locator('#voice-length-warning')).toContainText('Nothing has been inserted');
  await expect(page.locator('#voice-apply')).toBeDisabled();
  await expect(page.locator('#brief')).toHaveValue('Keep this brief');
});

test('reports permission and unsupported-browser errors while leaving typed input available', async ({ page }) => {
  await prepareVoicePage(page);
  await page.locator('#brief').fill('Typed fallback remains');
  await page.evaluate(() => { window.__denyMicrophone = true; });
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Microphone access was denied');
  await expect(page.locator('#brief')).toHaveValue('Typed fallback remains');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('secure page and a supported browser');
  await expect(page.locator('#brief')).toHaveValue('Typed fallback remains');
});

test('uses app-owned voice labels and disclosures in all six languages', async ({ page }) => {
  const { modelRequests } = await prepareVoicePage(page);
  await page.locator('#media-privacy > summary').click();
  for (const [language, title, start, networkDisclosure] of [
    ['en', 'Optional voice input', 'Allow and record', 'IP address'],
    ['de', 'Freiwillige Spracheingabe', 'Erlauben und aufnehmen', 'IP-Adresse'],
    ['fr', 'Saisie vocale facultative', 'Autoriser et enregistrer', 'adresse IP'],
    ['it', 'Input vocale facoltativo', 'Consenti e registra', 'indirizzo IP'],
    ['es', 'Entrada de voz opcional', 'Permitir y grabar', 'dirección IP'],
    ['pt', 'Entrada de voz opcional', 'Permitir e gravar', 'endereço IP'],
  ]) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('#voice-title')).toHaveText(title);
    await expect(page.locator('#voice-start')).toHaveText(start);
    await expect(page.locator('#voice-disclosure')).toContainText(networkDisclosure);
    await expect(page.locator('#voice-permission')).toContainText(networkDisclosure);
    await expect(page.locator('#voice-status')).toBeVisible();
  }
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);
  expect(modelRequests).toEqual([]);
});
