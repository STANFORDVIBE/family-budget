import { defineConfig } from "@playwright/test";

// The app under test is the real debug build (see e2e/app.ts); the Vite dev server serves its UI.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1430",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
