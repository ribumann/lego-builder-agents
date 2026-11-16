import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __microphoneCalls: number;
  }
}

for (const hosted of [false, true]) {
  test(`voice capture and model downloads are absent in ${hosted ? 'hosted' : 'local'} mode`, async ({ page }) => {
    const voiceRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/voice-transcribe'
          || url.hostname.includes('huggingface.co') || url.hostname.endsWith('hf.co'))
        voiceRequests.push(url.href);
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, '__microphoneCalls', { configurable: true, value: 0 });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => {
          window.__microphoneCalls++;
          throw new Error('BrickLab must not request microphone access.');
        } },
      });
    });
    await page.route('**/api/status', route => route.fulfill({ json: {
      hosted, sessionKey: 'voice-disabled-fixture',
      planner: { state: 'off', message: 'Copilot disabled for this test.' },
      azurePlanner: { enabled: hosted, state: hosted ? 'configured' : 'off',
        authentication: hosted ? 'anonymous' : 'entra', message: 'Planner fixture.' },
    } }));
    await page.goto('/');

    await expect(page.locator('#voice-unavailable'))
      .toHaveText('Voice input is unavailable in BrickLab across all modes. Type your brief instead.');
    await expect(page.locator('#voice-entry')).toHaveCount(0);
    await expect(page.locator('#voice-panel')).toHaveCount(0);
    await expect(page.locator('#brief')).toBeVisible();
    await expect(page.locator('#image-choose')).toBeVisible();
    await expect(page.locator('#plan')).toBeEnabled();
    await page.locator('#brief').fill('A typed blue spaceship with broad wings');
    await expect(page.locator('#brief')).toHaveValue('A typed blue spaceship with broad wings');
    expect(await page.evaluate(() => window.__microphoneCalls)).toBe(0);
    expect(voiceRequests).toEqual([]);
  });
}
