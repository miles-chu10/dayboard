import { defineConfig } from "@playwright/test";

// Electron E2E: specs in e2e/ launch the built app (`out/main/index.js`) with `_electron.launch`.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
});
