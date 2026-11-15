import { defineConfig } from '@playwright/test';

const port = process.env.BRICKLAB_TEST_PORT || '4173';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  fullyParallel: false,
  // SwiftShader rendering and screenshot capture share the CI runner's CPU.
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL,
    headless: true,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] },
  },
  webServer: {
    command: 'npm run start',
    url: baseURL,
    env: { PORT: port },
    reuseExistingServer: !process.env.CI && !process.env.BRICKLAB_TEST_PORT,
    timeout: 30_000,
  },
});
