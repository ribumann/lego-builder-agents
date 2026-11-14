import { test, expect } from '@playwright/test';

test('real MediaRecorder and Whisper accept a simulated microphone signal', async ({ page }) => {
  test.skip(process.env.BRICKLAB_TEST_REAL_WHISPER !== '1', 'Explicit opt-in downloads the pinned model.');
  test.setTimeout(360_000);
  const modelRequests: string[] = [];
  const failedRequests: string[] = [];
  let workers = 0;
  page.on('worker', () => { workers++; });
  page.on('request', request => {
    const host = new URL(request.url()).hostname;
    if (host === 'huggingface.co' || host.endsWith('.hf.co')) modelRequests.push(request.method());
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    failedRequests.push(`${url.host}: ${request.failure()?.errorText ?? 'request failed'}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(`${new URL(response.url()).host}: HTTP ${response.status()}`);
  });
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (event.data?.stage) document.documentElement.dataset.voiceFailureStage = event.data.stage;
        });
      }
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const context = new AudioContext();
          await context.resume();
          const tone = context.createOscillator();
          const output = context.createMediaStreamDestination();
          tone.frequency.value = 440;
          tone.connect(output);
          tone.start();
          window.addEventListener('pagehide', () => { tone.stop(); void context.close(); }, { once: true });
          return output.stream;
        },
      },
    });
  });
  await page.route('**/api/status', route => route.fulfill({ json: {
    sessionKey: 'fixture', planner: { state: 'off', message: 'Off' },
  } }));
  await page.goto('/');
  expect(modelRequests).toHaveLength(0);
  await page.locator('#voice-entry').click();
  await page.locator('#voice-start').click();
  await expect(page.locator('#voice-status')).toContainText('Recording');
  await page.waitForTimeout(1200);
  await page.locator('#voice-stop').click();
  await expect.poll(async () => page.locator('#voice-status').textContent(), { timeout: 330_000 })
    .not.toContain('Transcribing on this device');
  const stage = await page.evaluate(() => document.documentElement.dataset.voiceFailureStage || 'not reported');
  expect(await page.locator('#voice-status').textContent(), `Failure stage: ${stage}; network failures: ${failedRequests.join(', ') || 'none observed'}`)
    .toMatch(/Ready for voice input|No speech was transcribed/);
  expect(workers, `Status: ${await page.locator('#voice-status').textContent()}`).toBeGreaterThan(0);
  expect(modelRequests.every(method => method === 'GET' || method === 'HEAD')).toBe(true);
});
