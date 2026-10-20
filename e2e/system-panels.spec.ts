import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchDemo } from "./fixtures";

async function openQuickCapture(app: ElectronApplication): Promise<Page> {
  // The main window's first show takes focus, which would immediately hide a panel opened earlier.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) =>
            window.webContents.getURL().includes("main-window.html") && window.isVisible(),
        ),
      ),
    )
    .toBe(true);
  const opened = app.waitForEvent("window", (page) => page.url().endsWith("#capture"));
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById("quick-capture")?.click(),
  );
  return opened;
}

async function panelVisible(app: ElectronApplication, hash: string): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, hash) =>
      BrowserWindow.getAllWindows().some(
        (window) => window.webContents.getURL().endsWith(hash) && window.isVisible(),
      ),
    hash,
  );
}

test("File → Quick Capture opens the capture panel with its input focused", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toBeFocused();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Escape hides the capture panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    await panel.getByRole("textbox", { name: "Quick Capture" }).press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
  } finally {
    await demo.close();
  }
});

test("the capture panel cannot call unlisted channels", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const message = await panel.evaluate(() => {
      const { dayboard } = globalThis as unknown as {
        dayboard: { ipc: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } };
      };
      return dayboard.ipc.invoke("settings:update", {}).then(
        () => "allowed",
        (error: Error) => error.message,
      );
    });
    expect(message).toBe("This DayBoard window can't use settings:update.");
  } finally {
    await demo.close();
  }
});

test("Dock activation shows the main window while a panel is open", async () => {
  const demo = await launchDemo();
  try {
    await openQuickCapture(demo.app);
    await demo.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("main-window.html"))
        ?.hide();
    });
    await demo.app.evaluate(({ app }) => app.emit("activate", {}, true));
    await expect
      .poll(() =>
        demo.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) =>
              window.webContents.getURL().includes("main-window.html") && window.isVisible(),
          ),
        ),
      )
      .toBe(true);
  } finally {
    await demo.close();
  }
});

test("submitting in demo mode shows the demo refusal in the panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await input.fill("Call dentist Thursday 3pm");
    await input.press("Enter");
    await expect(panel.getByText("Couldn’t add “Call dentist Thursday 3pm”.")).toBeVisible();
    await expect(panel.getByText(/turned off in demo mode/)).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await expect(input).toHaveValue("");
  } finally {
    await demo.close();
  }
});
