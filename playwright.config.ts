import { defineConfig } from "@playwright/test";

// Renderer E2E for the floating panels. Specs load the production build (`npm run build`, served
// from ../runtime/build) in Chromium with a stubbed window.glazeAPI: they cover the panel UI and its
// IPC calls. Native window behaviour (floating level, Spaces, focus return) needs the Glaze host.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { browserName: "chromium" },
});
