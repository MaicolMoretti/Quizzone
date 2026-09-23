import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', actionTimeout: 10000, channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: [
    { command: 'node tests/browser/fixture-server.mjs', url: 'http://127.0.0.1:3101/health', timeout: 30000 },
    { command: 'npm run dev -- --webpack --hostname 127.0.0.1 --port 3100', url: 'http://127.0.0.1:3100', timeout: 120000,
      env: { QUIZZONE_DIST_DIR: '.next-e2e', QUIZZONE_TSCONFIG_PATH: 'tsconfig.e2e.json', NEXT_PUBLIC_APP_URL: 'http://localhost:3100', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54325', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key', NEXT_PUBLIC_GAME_SERVER_URL: 'http://127.0.0.1:3101' } },
  ],
});
