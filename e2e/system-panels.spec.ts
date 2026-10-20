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
  const panel = await opened;
  await expect.poll(() => panelVisible(app, "#capture")).toBe(true);
  return panel;
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

test("Escape that cancels an IME composition leaves the panel open", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await panel.getByRole("textbox", { name: "Quick Capture" }).evaluate((node) => {
      const { KeyboardEvent } = globalThis as unknown as {
        KeyboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
      };
      (node as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await panel.waitForTimeout(300);
    expect(await panelVisible(demo.app, "#capture")).toBe(true);
    await panel.keyboard.press("Escape");
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

    // Click-away: another DayBoard window takes focus after the show grace period
    // (SHOW_GRACE_MS, 300 ms, in main/system-panels/panel-window.ts).
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
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(true);
    await panel.keyboard.press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(false);
  } finally {
    await demo.close();
  }
});

// DayBoard Design System (v21, render 1791573676-ee86; live 1792522028-b5ac): popovers stay
// solid, placeholders end in an ellipsis, rows show their full title on hover and line up their
// times, failures with a way forward are red, labels are sentence case.
type DomGlobal = {
  document: { documentElement: unknown; activeElement: unknown };
  getComputedStyle(node: unknown): {
    backgroundColor: string;
    fontVariantNumeric: string;
    outlineOffset: string;
    outlineWidth: string;
    outlineStyle: string;
  };
};

test("the panels follow the design system's ground, input, row and copy rules", async () => {
  const demo = await launchDemo();
  try {
    const capture = await openQuickCapture(demo.app);
    const opaque = (page: Page) =>
      page.evaluate(() => {
        const dom = globalThis as unknown as DomGlobal;
        return dom.getComputedStyle(dom.document.documentElement).backgroundColor;
      });
    expect(await opaque(capture)).toMatch(/^rgb\(/);
    const input = capture.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toHaveAttribute("placeholder", /…$/);
    await input.fill("Call dentist Thursday 3pm");
    await input.press("Enter");
    const failure = capture.getByText(/turned off in demo mode/);
    await expect(failure).toBeVisible();
    expect(
      await failure.evaluate((node) => node.closest("[class*='bg-support-']")?.className ?? ""),
    ).toContain("bg-support-red-10");
    await capture.keyboard.press("Escape");

    const menubar = await openMenuBarAgenda(demo.app);
    expect(await opaque(menubar)).toMatch(/^rgb\(/);
    await expect(menubar.getByRole("textbox", { name: "Add or ask" })).toHaveAttribute(
      "placeholder",
      /^.{1,32}…$/,
    );
    const row = menubar.getByRole("region", { name: "Today's items" }).getByRole("button").first();
    const title = row.locator("span").last();
    await expect(title).toHaveAttribute("title", (await title.textContent()) ?? "");
    expect(
      await row
        .locator("span")
        .nth(1)
        .evaluate(
          (node) => (globalThis as unknown as DomGlobal).getComputedStyle(node).fontVariantNumeric,
        ),
    ).toContain("tabular-nums");

    // Rows take an inset 2px keyboard ring, like the app's other list rows (ListRow).
    for (let step = 0; step < 12; step += 1) {
      if (
        await row.evaluate(
          (node) => node === (globalThis as unknown as DomGlobal).document.activeElement,
        )
      )
        break;
      await menubar.keyboard.press("Tab");
    }
    const ring = await row.evaluate((node) => {
      const style = (globalThis as unknown as DomGlobal).getComputedStyle(node);
      return { offset: style.outlineOffset, width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(ring).toEqual({ offset: "-2px", width: "2px", style: "solid" });
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

test("account changes clear capture failures and recovered drafts", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    await panel.getByRole("textbox", { name: "Quick Capture" }).fill("Private account A draft");
    await demo.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith("#capture"),
      );
      panel?.webContents.send("dayboard:notification", {
        channel: "capture:changed",
        params: {
          records: [
            {
              id: "old-account",
              text: "Private account A failure",
              state: "failed",
              draft: null,
              partial: { title: "Private account A failure" },
              error: "Could not save",
              createdAt: "2026-10-20T00:00:00Z",
              canUndo: false,
            },
          ],
        },
      });
    });
    await expect(panel.getByText(/Private account A failure/)).toBeVisible();
    await demo.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith("#capture"),
      );
      panel?.webContents.send("dayboard:notification", { channel: "accounts:changed", params: {} });
      panel?.webContents.send("dayboard:notification", {
        channel: "capture:changed",
        params: { records: [] },
      });
    });
    await expect(panel.getByText(/Private account A failure/)).toHaveCount(0);
    await expect(panel.getByRole("textbox", { name: "Quick Capture" })).toHaveValue("");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

for (const surface of ["capture", "menubar"] as const) {
  test(`${surface} discards a recent-capture read that completes after an account change`, async () => {
    const demo = await launchDemo();
    try {
      await demo.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("capture:recent");
        ipcMain.handle(
          "capture:recent",
          () =>
            new Promise((resolve) => {
              (globalThis as unknown as { releaseRecent: () => void }).releaseRecent = () =>
                resolve([
                  {
                    id: "old-account",
                    text: "Private stale account A record",
                    state: "failed",
                    draft: null,
                    partial: null,
                    error: "Private failure",
                    canUndo: false,
                    createdAt: "2026-10-20T00:00:00Z",
                  },
                ]);
            }),
        );
      });
      const panel =
        surface === "capture"
          ? await openQuickCapture(demo.app)
          : await openMenuBarAgenda(demo.app);
      await expect
        .poll(() =>
          demo.app.evaluate(
            () => typeof (globalThis as unknown as { releaseRecent?: unknown }).releaseRecent,
          ),
        )
        .toBe("function");
      await demo.app.evaluate(({ BrowserWindow }, surface) => {
        const panel = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith(`#${surface}`),
        );
        panel?.webContents.send("dayboard:notification", {
          channel: "accounts:changed",
          params: {},
        });
        (globalThis as unknown as { releaseRecent: () => void }).releaseRecent();
      }, surface);
      await panel.waitForTimeout(200);
      await expect(panel.getByText(/Private stale account A/)).toHaveCount(0);
      expect(demo.errors).toEqual([]);
    } finally {
      await demo.close();
    }
  });

  test(`${surface} discards a submit rejection that completes after an account change`, async () => {
    const demo = await launchDemo();
    try {
      await demo.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("capture:submit");
        ipcMain.handle(
          "capture:submit",
          () =>
            new Promise((_resolve, reject) => {
              (globalThis as unknown as { rejectCapture: () => void }).rejectCapture = () =>
                reject(new Error("Private old-account error"));
            }),
        );
      });
      const panel =
        surface === "capture"
          ? await openQuickCapture(demo.app)
          : await openMenuBarAgenda(demo.app);
      const input = panel.getByRole("textbox", {
        name: surface === "capture" ? "Quick Capture" : "Add or ask",
      });
      await input.fill("Private account A submission");
      await input.press("Enter");
      await expect
        .poll(() =>
          demo.app.evaluate(
            () => typeof (globalThis as unknown as { rejectCapture?: unknown }).rejectCapture,
          ),
        )
        .toBe("function");
      await demo.app.evaluate(({ BrowserWindow }, surface) => {
        const panel = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith(`#${surface}`),
        );
        panel?.webContents.send("dayboard:notification", {
          channel: "accounts:changed",
          params: {},
        });
        (globalThis as unknown as { rejectCapture: () => void }).rejectCapture();
      }, surface);
      await panel.waitForTimeout(200);
      if (surface === "capture") {
        expect(await panelVisible(demo.app, "#capture")).toBe(false);
        await reopenQuickCapture(demo.app);
      }
      await expect(input).toHaveValue("");
      await expect(panel.getByText(/Private old-account error/)).toHaveCount(0);
      await expect(panel.getByText(/Private account A submission/)).toHaveCount(0);
      expect(demo.errors).toEqual([]);
    } finally {
      await demo.close();
    }
  });
}

for (const surface of ["agenda", "menubar"] as const) {
  for (const notesImport of [true, false]) {
    test(`${surface} post-meeting notes ${notesImport ? "remain visible" : "are hidden"} with Up Next off`, async () => {
      const profile = await createTestProfile();
      await writeFile(
        path.join(profile, "demo-settings.json"),
        JSON.stringify({ system: { meetings: { upNext: false, notesImport } } }),
      );
      const demo = await launchDemo(profile);
      try {
        const page = surface === "agenda" ? demo.page : await openMenuBarAgenda(demo.app);
        await atTodayTime(page, 9, 50);
        await expect(page.getByRole("heading").first()).toBeVisible();
        await expect(page.getByRole("region", { name: "Up next meeting" })).toHaveCount(0);
        const ended = page.getByRole("region", { name: "Meeting that just ended" });
        if (notesImport) {
          await expect(ended).toBeVisible();
          await expect(ended.getByText("Team standup")).toBeVisible();
        } else {
          await expect(ended).toHaveCount(0);
        }
        expect(demo.errors).toEqual([]);
      } finally {
        await demo.close();
      }
    });
  }
}

test("manual capture waits for account availability and selects a usable destination", async () => {
  const profile = await createTestProfile();
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ ai: { features: { capture: false } } }),
  );
  const demo = await launchDemo(profile);
  try {
    await demo.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("accounts:getStatus");
      ipcMain.handle(
        "accounts:getStatus",
        () =>
          new Promise((resolve) => {
            (globalThis as unknown as { releaseAccounts: () => void }).releaseAccounts = () =>
              resolve({ google: { connected: true }, reminders: "denied" });
          }),
      );
    });
    const panel = await openQuickCapture(demo.app);
    await expect(panel.getByRole("textbox", { name: "Quick Capture" })).toBeDisabled();
    await expect
      .poll(() =>
        demo.app.evaluate(
          () => typeof (globalThis as unknown as { releaseAccounts?: unknown }).releaseAccounts,
        ),
      )
      .toBe("function");
    await demo.app.evaluate(() =>
      (globalThis as unknown as { releaseAccounts: () => void }).releaseAccounts(),
    );
    await expect(panel.getByRole("button", { name: "Add task", exact: true })).toBeEnabled();
    await expect(panel.getByRole("radio", { name: "Task", exact: true })).toBeChecked();
    await expect(panel.getByRole("radio", { name: "Reminder", exact: true })).toBeDisabled();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("a notes-changed notification refreshes Agenda and Menubar together", async () => {
  const demo = await launchDemo();
  try {
    await demo.app.evaluate(({ ipcMain }) => {
      (globalThis as unknown as { notesImported: boolean }).notesImported = false;
      ipcMain.removeHandler("meetings:getNotes");
      ipcMain.handle(
        "meetings:getNotes",
        (_event, { events }: { events: { calendarId: string; eventId: string }[] }) =>
          Object.fromEntries(
            events.map((event) => [
              `${event.calendarId}/${event.eventId}`,
              {
                providerMeetingId: "synthetic-meeting",
                providerUrl: null,
                title: "Synthetic notes",
                importedAt: "2026-10-20T09:45:00Z",
                text: (globalThis as unknown as { notesImported: boolean }).notesImported
                  ? "Fresh complete meeting notes"
                  : "Previous meeting notes",
              },
            ]),
          ),
      );
    });
    await atTodayTime(demo.page, 9, 50);
    const menubar = await openMenuBarAgenda(demo.app);
    await atTodayTime(menubar, 9, 50);
    for (const page of [demo.page, menubar])
      await expect(page.getByText("Previous meeting notes", { exact: true })).toBeVisible();
    await demo.app.evaluate(({ BrowserWindow }) => {
      (globalThis as unknown as { notesImported: boolean }).notesImported = true;
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("dayboard:notification", {
          channel: "meetings:notesChanged",
          params: { calendarId: "work", eventId: "e1" },
        });
    });
    for (const page of [demo.page, menubar]) {
      await expect(page.getByText("Fresh complete meeting notes", { exact: true })).toBeVisible();
      await expect(page.getByText("Previous meeting notes", { exact: true })).toHaveCount(0);
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
