import { expect, test, type Page } from "@playwright/test";
import type { AppSettings, SourceId } from "../main/shared-types";
import { BridgeChannel, type DayboardBridge } from "../shared/bridge-protocol";
import { launchDemo, type DemoApp } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };
type FixtureGlobal = typeof globalThis & {
  dayboardUiSourceRelease?: (value: unknown) => void;
  dayboardUiCalendarCalls?: number;
};

function navigation(page: Page, title: string) {
  return page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

// Replace only a source handler inside this owned demo app. Other handlers keep their demo behavior.
async function sourceResponse(demo: DemoApp, source: SourceId, result?: unknown, error?: string) {
  await demo.app.evaluate(
    ({ ipcMain, BrowserWindow }, input) => {
      const channel = `${input.source}:list`;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        if (input.error) throw new Error(input.error);
        return input.result;
      });
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(input.notification, {
          channel: "data:changed",
          params: { source: input.source },
        });
      }
    },
    { source, result, error, notification: BridgeChannel.notification },
  );
}

test("Sidebar distinguishes loading, unavailable, saved, partial and empty sources", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    const calendar = navigation(page, "Calendar");
    await demo.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("calendar:list");
      ipcMain.handle(
        "calendar:list",
        () =>
          new Promise(
            (resolve) => ((globalThis as FixtureGlobal).dayboardUiSourceRelease = resolve),
          ),
      );
    });
    await page.reload();
    await expect(calendar).toContainText("Loading…");
    await expect(calendar).not.toContainText("Nothing else today");
    await demo.app.evaluate(() => {
      (globalThis as FixtureGlobal).dayboardUiSourceRelease!({ state: "not-connected" });
    });
    await expect(calendar).toContainText("Not signed in");
    await sourceResponse(demo, "calendar", { state: "needs-setup" });
    await expect(calendar).toContainText("Sign-in unavailable");
    await sourceResponse(demo, "calendar", undefined, "Synthetic calendar failure");
    await page.reload();
    await expect(calendar).toContainText("Unavailable");
    await expect(calendar).not.toContainText("Nothing else today");
    await sourceResponse(demo, "calendar", { state: "ok", items: [] });
    await expect(calendar).toContainText("Nothing else today");
    await sourceResponse(demo, "calendar", undefined, "Synthetic refresh failure");
    await expect(calendar).toContainText("Refresh failed");
    await expect(calendar).not.toContainText("Nothing else today");
    await sourceResponse(demo, "calendar", {
      state: "ok",
      items: [],
      coverage: { complete: false },
    });
    await expect(calendar).toContainText("Partially loaded");
    await expect(calendar).not.toContainText("Nothing else today");
    await sourceResponse(demo, "calendar", { state: "ok", items: [] });
    await expect(calendar).toContainText("Nothing else today");
    await sourceResponse(demo, "tasks", { state: "needs-setup" });
    await expect(navigation(page, "Tasks")).toContainText("Sign-in unavailable");
    await sourceResponse(demo, "reminders", { state: "no-access", access: "denied" });
    await expect(navigation(page, "Reminders")).toContainText("Needs access");
    await sourceResponse(demo, "mail", { state: "not-connected" });
    await expect(navigation(page, "Inbox")).toContainText("Not signed in");
    await page.screenshot({ path: testInfo.outputPath("source-navigation-states.png") });
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Sidebar clock advances next events without source refresh and retains saved summaries", async () => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await page.evaluate(async () => {
      const ipc = (globalThis as AppGlobal).dayboard.ipc;
      const settings = await ipc.invoke<AppSettings>("settings:get");
      await ipc.invoke("settings:update", {
        ...settings,
        general: { ...settings.general, refreshMinutes: 0 },
      });
    });
    const now = Date.now();
    await page.clock.install({ time: new Date(now) });
    await demo.app.evaluate(({ ipcMain }, time) => {
      (globalThis as FixtureGlobal).dayboardUiCalendarCalls = 0;
      ipcMain.removeHandler("calendar:list");
      ipcMain.handle("calendar:list", () => {
        (globalThis as FixtureGlobal).dayboardUiCalendarCalls!++;
        return {
          state: "ok",
          items: [
            {
              id: "fixture-clock-event",
              calendarId: "fixture-calendar",
              calendarName: "Fixture calendar",
              title: "Fixture clock handoff",
              start: new Date(time + 120_000).toISOString(),
              end: new Date(time + 240_000).toISOString(),
              allDay: false,
            },
          ],
        };
      });
    }, now);
    await page.reload();
    const calendar = navigation(page, "Calendar");
    const next = page.getByRole("button", { name: "Open next event: Fixture clock handoff" });
    await expect(calendar).toContainText("Fixture clock handoff");
    await expect(next).toContainText("Up next");
    const calls = await demo.app.evaluate(
      () => (globalThis as FixtureGlobal).dayboardUiCalendarCalls,
    );
    await page.clock.fastForward(180_000);
    await expect(next).toContainText("Now");
    expect(
      await demo.app.evaluate(() => (globalThis as FixtureGlobal).dayboardUiCalendarCalls),
    ).toBe(calls);
    await sourceResponse(demo, "calendar", undefined, "Synthetic refresh failure");
    await expect(calendar).toContainText("Fixture clock handoff");
    await expect(calendar).toContainText("Refresh failed");
    await expect(calendar).not.toContainText("Nothing else today");
    await sourceResponse(demo, "calendar", {
      state: "ok",
      items: [
        {
          id: "fixture-clock-event",
          calendarId: "fixture-calendar",
          calendarName: "Fixture calendar",
          title: "Fixture clock handoff",
          start: new Date(now + 120_000).toISOString(),
          end: new Date(now + 240_000).toISOString(),
          allDay: false,
        },
      ],
      coverage: { complete: false },
    });
    await expect(calendar).toContainText("Fixture clock handoff");
    await expect(calendar).toContainText("Partially loaded");
    await sourceResponse(demo, "calendar", undefined, "Synthetic refresh failure");
    await page.clock.fastForward(120_000);
    await expect(next).toHaveCount(0);
    await expect(calendar).toContainText("Refresh failed");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Calendar context survives repeated navigation and capture cancellation", async () => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    for (let attempt = 0; attempt < 2; attempt++) {
      await navigation(page, "Calendar").click();
      await page.getByRole("radio", { name: "Schedule", exact: true }).click();
      await expect(page.locator("[data-page-header] h1")).toHaveText("Calendar");
      await page.keyboard.press("Meta+f");
      await expect(
        page.getByRole("textbox", { name: "Search calendar", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "New task, reminder, or event", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "New Item", exact: true });
      await expect(dialog).toBeVisible();
      if (attempt === 0) await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      else await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-page-header] h1")).toHaveText("Calendar");
      await navigation(page, "Inbox").click();
      await navigation(page, "Agenda").click();
      await expect(page.locator("[data-page-header] h1")).toHaveText("Agenda");
      await page.keyboard.press("Meta+f");
      await expect(page.getByRole("textbox", { name: "Search agenda", exact: true })).toBeFocused();
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
