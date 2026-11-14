import { test, expect, type Page } from '@playwright/test';

type VoiceCalls = { microphone: number; tracksStopped: number; workers: number };

declare global {
  interface Window {
    __voiceCalls: VoiceCalls;
    __mockTranscript: string;
    __denyMicrophone: boolean;
  }
}

async function prepareVoicePage(page: Page) {
  const modelRequests: string[] = [];
  const planRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname.includes('huggingface.co') || url.hostname.endsWith('hf.co')) modelRequests.push(url.href);
    if (url.pathname === '/api/plan') planRequests.push(url.href);
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
  await page.route('**/api/status', route => route.fulfill({ json: {
    copilot: true, sessionKey: 'voice-fixture', planner: { state: 'ready', message: 'Ready' },
  } }));
  await page.goto('/');
  return { modelRequests, planRequests };
}

test('discloses voice processing before permission and keeps transcript separate until explicit apply', async ({ page }) => {
  const { modelRequests, planRequests } = await prepareVoicePage(page);
  await expect(page.locator('#voice-disclosure')).toContainText('45 MB');
  await expect(page.locator('#voice-disclosure')).toContainText('IP address');
  await expect(page.locator('#voice-disclosure')).toContainText('browser cache');
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);
  expect(modelRequests).toEqual([]);
  expect(planRequests).toEqual([]);

  await page.locator('#brief').fill('Typed during recording');
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Recording');
  await expect(page.locator('#voice-start')).toBeDisabled();
  await expect(page.locator('#voice-stop')).toBeEnabled();
  await expect(page.locator('#voice-cancel')).toBeEnabled();
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
  await expect(page.locator('#brief')).toHaveValue('A blue dinosaur with a gold crest');
  expect(modelRequests).toEqual([]);
  expect(planRequests).toEqual([]);

  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Recording');
  await page.locator('#voice-cancel').click();
  await expect(page.locator('#voice-status')).toHaveText('Ready for voice input');
  await expect(page.locator('#brief')).toHaveValue('A blue dinosaur with a gold crest');
  await expect(page.locator('#voice-transcript')).toHaveValue('A blue dinosaur with a gold crest');
});

test('preserves transcript edits made while recording and requires review before replacing them', async ({ page }) => {
  await prepareVoicePage(page);
  await page.locator('#voice-transcript').fill('My existing edited transcript');
  await page.locator('#voice-start').click();
  await page.locator('#voice-transcript').fill('An edit made during recording');
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
    await expect(page.locator('#voice-status')).toBeVisible();
  }
  expect(await page.evaluate(() => window.__voiceCalls.microphone)).toBe(0);
  expect(modelRequests).toEqual([]);
});
