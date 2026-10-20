import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestProfile, launchDemo } from "./fixtures";

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

async function reopenQuickCapture(app: ElectronApplication) {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById("quick-capture")?.click(),
  );
  await expect.poll(() => panelVisible(app, "#capture")).toBe(true);
}

test("the first keystrokes after each reopen reach the capture input", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await panel.keyboard.type("a");
    await expect(input).toHaveValue("a");

    await panel.keyboard.press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
    await reopenQuickCapture(demo.app);
    await panel.keyboard.type("b");
    await expect(input).toHaveValue("ab");

    // Click-away: another DayBoard window takes focus after the show grace period.
    await panel.waitForTimeout(400);
    await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("main-window.html"))
        ?.focus(),
    );
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
    await reopenQuickCapture(demo.app);
    await panel.keyboard.type("c");
    await expect(input).toHaveValue("abc");

    // A rejected submit hides the panel and shows it again with the refusal.
    await panel.keyboard.press("Enter");
    await expect(panel.getByText(/turned off in demo mode/)).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await panel.keyboard.type("d");
    await expect(input).toHaveValue("d");
  } finally {
    await demo.close();
  }
});

async function openMenuBarAgenda(app: ElectronApplication): Promise<Page> {
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
  const opened = app.waitForEvent("window", (page) => page.url().endsWith("#menubar"));
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById("menubar-agenda")?.click(),
  );
  return opened;
}

test("File → Menu Bar Agenda shows today's panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await expect(panel.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Today's items" })).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Escape hides a freshly shown menu-bar panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await expect(panel.getByRole("heading", { name: "Today" })).toBeVisible();
    await panel.keyboard.press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(false);
  } finally {
    await demo.close();
  }
});

test("Open DayBoard from the menu-bar panel shows the main window", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await demo.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("main-window.html"))
        ?.hide();
    });
    await panel.getByRole("button", { name: "Open DayBoard" }).click();
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(false);
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

async function atTodayTime(page: Page, hours: number, minutes: number) {
  const now = new Date();
  await page.clock.install({
    time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes),
  });
  await page.reload();
}

test("the Up Next card shows the next demo meeting on Agenda", async () => {
  const demo = await launchDemo();
  try {
    await atTodayTime(demo.page, 9, 25);
    const card = demo.page.getByRole("region", { name: "Up next meeting" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Team standup")).toBeVisible();
    await expect(card.getByText(/Starts in 5 min/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Join" })).toBeVisible();
  } finally {
    await demo.close();
  }
});

test("turning off the Up Next card hides it on Agenda", async () => {
  const profile = await createTestProfile();
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ system: { meetings: { upNext: false } } }),
  );
  const demo = await launchDemo(profile);
  try {
    await atTodayTime(demo.page, 9, 25);
    await expect(demo.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(demo.page.getByRole("region", { name: "Up next meeting" })).toHaveCount(0);
  } finally {
    await demo.close();
  }
});
