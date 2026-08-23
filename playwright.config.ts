import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
