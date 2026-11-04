import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { launchDemo } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

function sidebarItem(page: Page, title: string) {
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

async function sidebarTitles(page: Page): Promise<string[]> {
  const titles = await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button")
    .allInnerTexts();
  return titles.map((text) => text.split("\n")[0].trim());
}

async function clickMenu(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.click(), id);
}

test("Sidebar settings reorder and hide views and turn off counts; ⌃ numbers follow", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await expect(sidebarItem(page, "Inbox")).toBeVisible();
    await page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"));
    await expect
      .poll(() => demo.app.windows().find((window) => /settings-window/.test(window.url())))
      .not.toBeUndefined();
    const settings = demo.app.windows().find((window) => /settings-window/.test(window.url()))!;
    await settings.waitForLoadState("domcontentloaded");
    await settings.getByRole("tab", { name: "General", exact: true }).click();

    const views = settings.getByRole("list", { name: "Sidebar views" });
    await expect(views.getByRole("switch", { name: "Show Home" })).toBeDisabled();
    await expect(views.getByRole("button", { name: "Move Home up" })).toBeDisabled();
    // Inbox moves to the top, and Agenda leaves the sidebar.
    for (let step = 0; step < 3; step++)
      await views.getByRole("button", { name: "Move Inbox up" }).click();
    await views.getByRole("switch", { name: "Show Agenda" }).click();
    await settings.getByRole("switch", { name: "Show counts" }).click();
    await views.scrollIntoViewIfNeeded();
    await settings.screenshot({
      path: testInfo.outputPath("sidebar-settings.png"),
    });

    await expect
      .poll(() => sidebarTitles(page))
      .toEqual([
        "Inbox",
        "Home",
        "Calendar",
        "Tasks",
        "Reminders",
        "Notes",
        "Assistant",
        "Weekly Review",
        "MCP Servers",
      ]);
    // No count pills once counts are off.
    await expect(sidebarItem(page, "Inbox")).not.toContainText(/\d+$/);

    await page.bringToFront();
    await page.keyboard.press("Control+Digit1");
    await expect(sidebarItem(page, "Inbox")).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Control+Digit2");
    await expect(sidebarItem(page, "Home")).toHaveAttribute("aria-current", "page");

    // A hidden view is still one ⌘K away.
    await page.keyboard.press("Meta+K");
    await page.keyboard.type("go agenda");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Agenda|Today/ }).first()).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("⌘T opens a tab strip; each tab keeps its view, ⌘1 and ⌃Tab switch, ⌘W closes a tab", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await expect(sidebarItem(page, "Home")).toHaveAttribute("aria-current", "page");
    const strip = page.getByRole("tablist", { name: "Tabs" });
    await expect(strip).toHaveCount(0);

    await sidebarItem(page, "Inbox").click();
    await clickMenu(demo.app, "new-tab");
    await expect(strip.getByRole("tab")).toHaveCount(2);
    // A new tab starts on Home, and the first tab still remembers Inbox.
    await expect(strip.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    await expect(sidebarItem(page, "Home")).toHaveAttribute("aria-current", "page");
    await sidebarItem(page, "Notes").click();
    await expect(strip.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.screenshot({ path: testInfo.outputPath("tabs.png") });

    await strip.getByRole("tab", { name: "Inbox" }).click();
    await expect(sidebarItem(page, "Inbox")).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Control+Tab");
    await expect(sidebarItem(page, "Notes")).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Meta+Digit1");
    await expect(sidebarItem(page, "Inbox")).toHaveAttribute("aria-current", "page");

    // ⌘W closes the active tab while there are two, and the window stays open.
    await clickMenu(demo.app, "close");
    await expect(strip).toHaveCount(0);
    await expect(sidebarItem(page, "Notes")).toHaveAttribute("aria-current", "page");
    expect(
      await demo.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) =>
            window.webContents.getURL().includes("main-window.html") && window.isVisible(),
        ),
      ),
    ).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("tabs come back after a relaunch, with the active tab showing the launch view", async () => {
  const first = await launchDemo();
  const profile = first.profile;
  try {
    const strip = first.page.getByRole("tablist", { name: "Tabs" });
    await expect(sidebarItem(first.page, "Home")).toHaveAttribute("aria-current", "page");
    await clickMenu(first.app, "new-tab");
    await sidebarItem(first.page, "Notes").click();
    await expect(strip.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  } finally {
    await first.close(false);
  }
  const second = await launchDemo(profile);
  try {
    const strip = second.page.getByRole("tablist", { name: "Tabs" });
    await expect(strip.getByRole("tab")).toHaveCount(2);
    // DayBoard opens on Home, so the active tab now says Home rather than Notes.
    await expect(sidebarItem(second.page, "Home")).toHaveAttribute("aria-current", "page");
    await expect(strip.getByRole("tab", { selected: true })).toHaveText("Home");
    expect(second.errors).toEqual([]);
  } finally {
    await second.close();
  }
});
