if (
  process.env.NODE_ENV !== 'test' ||
  process.env.CONFIRM_TEST_DATABASE !== 'yes' ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/novacart_test_')
)
  throw new Error('Browser tests require an explicitly disposable database');
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:' + (process.env.QA_PORT || 3210),
    headless: true,
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {},
  },
  reporter: [['list'], ['json', { outputFile: 'test-artifacts/browser-results.json' }]],
  outputDir: 'test-artifacts/browser',
});
