import { defineConfig } from '@playwright/test';

// End-to-end gate for merges to main (no CI): runs against the production build served by
// `vite preview`, at 1920x1080 so the 960x540 view scales by exactly 2.
export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5299',
    viewport: { width: 1920, height: 1080 },
  },
  webServer: {
    command: 'npx vite preview apps/web --port 5299 --strictPort',
    url: 'http://localhost:5299',
    reuseExistingServer: false,
  },
});
