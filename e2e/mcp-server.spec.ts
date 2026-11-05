import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import path from "node:path";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { resolveProfileOverride } from "../main/platform/isolated-profile.js";
import { mcpProjectIdForProfile, stableMcpPort } from "../main/services/mcp-port.js";
import { createEmptyProfile, launchEmptyProfile, root } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

function hold(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const TOAST_CONTRAST = readFileSync(path.join(root, "e2e", "toast-contrast.browser.js"), "utf8")
  .trim()
  .replace(/;$/, "");

function toastContrast(settings: Page) {
  return settings.evaluate<{ title: number; icon: number; backgroundLuminance: number }>(
    `(${TOAST_CONTRAST})()`,
  );
}

test("a busy MCP port is explained in Settings, the toast is readable in light and dark, and the server starts once the port is free", async ({
  playwright: _playwright,
}, testInfo) => {
  const profile = await createEmptyProfile({
    enabled: true,
    allowWrites: false,
  });
  const port = stableMcpPort(mcpProjectIdForProfile(resolveProfileOverride(profile)));
  const blocker = await hold(port);
  const empty = await launchEmptyProfile(profile);
  try {
    await empty.page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"),
    );
    await expect
      .poll(() => empty.app.windows().find((window) => /settings-window/.test(window.url())))
      .toBeTruthy();
    const settings = empty.app.windows().find((window) => /settings-window/.test(window.url()))!;
    // Increase Contrast (as on Miles's Mac) gives the toast DayBoard's opaque background, where the
    // old light-palette text was unreadable; without it the old toast was white in dark mode.
    await settings.emulateMedia({ colorScheme: null, contrast: "more" });
    const busy = `Port ${port} is in use, probably by another copy of DayBoard. Quit it and DayBoard's MCP server starts on its own.`;

    for (const theme of ["Dark", "Light"]) {
      await settings.getByRole("tab", { name: "General", exact: true }).click();
      await settings.getByRole("radio", { name: theme, exact: true }).click();
      await expect(settings.locator("html")).toHaveClass(new RegExp(theme.toLowerCase()));
      await settings.getByRole("tab", { name: "MCP Servers", exact: true }).click();
      await expect(settings.getByText(busy).first()).toBeVisible();

      await settings.getByRole("button", { name: "Claude Code", exact: true }).click();
      const toast = settings.locator("[data-sonner-toast]").filter({ hasText: busy });
      await expect(toast).toBeVisible();
      const contrast = await toastContrast(settings);
      expect(
        contrast.title,
        `${theme} toast text ${JSON.stringify(contrast)}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast.icon, `${theme} toast icon`).toBeGreaterThanOrEqual(3);
      if (theme === "Dark") expect(contrast.backgroundLuminance, "dark toast").toBeLessThan(0.2);
      else expect(contrast.backgroundLuminance, "light toast").toBeGreaterThan(0.6);
      await settings.screenshot({
        path: testInfo.outputPath(`mcp-busy-port-toast-${theme.toLowerCase()}.png`),
        animations: "disabled",
      });
      await expect(settings.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
    }

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await expect(settings.getByText(`http://127.0.0.1:${port}/mcp`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(settings.getByText(busy)).toHaveCount(0);
    expect(empty.errors).toEqual([]);
  } finally {
    if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await empty.close();
  }
});
