import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const local = baseURL.startsWith('http://localhost');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  ...(local
    ? {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000/login',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});