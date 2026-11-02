import { defineConfig, devices } from '@playwright/test';

// A port of its own, so e2e runs don't collide with `pnpm dev` (5173) or `pnpm start` (3000).
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // E2E runs against a fresh production build, the way the app ships. Never reuse
  // a server already on the port: it could be a dev server, another worktree or a
  // stale build, and the run would test that instead of the current code.
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `${BASE_URL}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
