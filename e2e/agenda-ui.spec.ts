import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { launchDemo } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

async function navigate(page: Page, title: string) {
  const button = page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

async function resize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => !/settings-window/.test(window.webContents.getURL()),
      );
      if (!window) throw new Error("Missing main window");
      window.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

test("Agenda date navigation preserves search, keyboard order and saved source filters", async () => {
  const demo = await launchDemo();
  let relaunched: Awaited<ReturnType<typeof launchDemo>> | undefined;
  try {
    const page = demo.page;
    const heading = page.locator("[data-agenda-range]");
    const search = page.getByRole("textbox", { name: "Search agenda" });
    const today = page.getByRole("button", { name: "Today", exact: true });
    const previous = page.getByRole("button", { name: "Previous date", exact: true });
    const next = page.getByRole("button", { name: "Next date", exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByRole("radio", { name: "Day", exact: true })).toBeChecked();
    const initial = await heading.textContent();
    await today.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(previous).toBeFocused();
    await today.focus();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
    await next.press("Enter");
    await expect(heading).not.toHaveText(initial!);
    await expect(heading.locator("..")).not.toContainText("due today");
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    await today.click();
    await expect(heading).toHaveText(initial!);

    await page.keyboard.press("Meta+f");
    await expect(search).toBeFocused();
    await search.fill("Finalize");
    await next.click();
    await expect(search).toHaveValue("Finalize");
    await today.click();
    await expect(search).toHaveValue("Finalize");
    await search.fill("");

    const mail = page.getByRole("checkbox", { name: "Show Gmail", exact: true });
    await mail.focus();
    await mail.press("Space");
    await expect(mail).not.toBeChecked();
    await navigate(page, "Inbox");
    await navigate(page, "Agenda");
    await expect(mail).not.toBeChecked();

    const separator = page.getByRole("separator").first();
    const box = await separator.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2);
    await page.mouse.up();
    const storedWidth = await page.evaluate(() =>
      localStorage.getItem("dayboard:split-view:productivity-shell:sidebar"),
    );
    expect(Number(storedWidth)).toBeGreaterThan(220);
    await demo.close(false);
    relaunched = await launchDemo(demo.profile);
    await expect(
      relaunched.page.getByRole("checkbox", { name: "Show Gmail", exact: true }),
    ).not.toBeChecked();
    expect(
      await relaunched.page.evaluate(() =>
        localStorage.getItem("dayboard:split-view:productivity-shell:sidebar"),
      ),
    ).toBe(storedWidth);
    expect([...demo.errors, ...relaunched.errors]).toEqual([]);
  } finally {
    if (relaunched) await relaunched.close();
    else if (demo.app.process().exitCode === null) await demo.close();
  }
});

test("Calendar Schedule retains its mode and range while resetting the selected date", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await navigate(page, "Calendar");
    await page.getByRole("radio", { name: "Schedule", exact: true }).click();
    await expect(page.locator("[data-page-header] h1")).toHaveText("Calendar");
    await expect(page.getByRole("textbox", { name: "Search calendar", exact: true })).toBeVisible();
    const heading = page.locator("[data-agenda-range]");
    await expect(heading).toBeVisible();
    await page.getByRole("combobox", { name: "Calendar range" }).click();
    await page.getByRole("option", { name: "Today", exact: true }).click();
    const initial = await heading.textContent();
    await page.getByRole("button", { name: "Next date", exact: true }).click();
    await expect(heading).not.toHaveText(initial!);
    await expect(page.getByRole("radio", { name: "Schedule", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(heading).toHaveText(initial!);
    await page.getByRole("combobox", { name: "Calendar range" }).click();
    await page.getByRole("option", { name: "Next 7 days", exact: true }).click();
    await expect(heading).not.toHaveText(initial!);
    const range = await heading.textContent();
    await page.getByRole("button", { name: "Next date", exact: true }).click();
    await expect(heading).not.toHaveText(range!);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(heading).toHaveText(range!);
    await expect(page.getByRole("combobox", { name: "Calendar range" })).toHaveText("Next 7 days");
    await page.screenshot({ path: testInfo.outputPath("calendar-schedule-range.png") });
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Agenda stays usable in light/dark and default/compact at the minimum window with details", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    // Default media emulation masks Electron's native appearance changes.
    await page.emulateMedia({ colorScheme: null });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect
      .poll(() => demo.app.windows().find((window) => /settings-window/.test(window.url())))
      .toBeTruthy();
    const settings = demo.app.windows().find((window) => /settings-window/.test(window.url()))!;
    await settings.emulateMedia({ colorScheme: null });
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    await settings.getByRole("radio", { name: "Side panel", exact: true }).click();

    for (const theme of ["Light", "Dark"]) {
      await settings.getByRole("radio", { name: theme, exact: true }).click();
      await expect(settings.getByRole("radio", { name: theme, exact: true })).toBeChecked();
      expect(
        await page.evaluate(() => (globalThis as AppGlobal).dayboard.nativeTheme.getInfo()),
      ).toMatchObject({
        themeSource: theme.toLowerCase(),
        shouldUseDarkColors: theme === "Dark",
      });
      await expect(page.locator("html")).toHaveClass(new RegExp(theme.toLowerCase()));
      for (const density of ["Default", "Compact"]) {
        await settings.getByRole("radio", { name: density, exact: true }).click();
        if (density === "Compact")
          await expect(page.locator("html")).toHaveClass(/density-compact/);
        else await expect(page.locator("html")).not.toHaveClass(/density-compact/);
        await resize(demo.app, 1280, 820);
        await expect(page.locator("[data-agenda-range]")).toHaveCSS("font-size", "18px");
        await page.screenshot({
          path: testInfo.outputPath(`agenda-${theme.toLowerCase()}-${density.toLowerCase()}.png`),
          animations: "disabled",
        });
        await resize(demo.app, 800, 600);
        await page
          .getByRole("group", { name: "Finalize launch announcement", exact: true })
          .click();
        const details = page.getByRole("complementary", { name: "Details" });
        await expect(details).toBeVisible();
        await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
        const search = page.getByRole("textbox", { name: "Search agenda" });
        await search.focus();
        await search.press("Tab");
        await expect(page.getByRole("checkbox", { name: "Show Google Tasks" })).toBeFocused();
        const viewport = page.locator("[data-radix-scroll-area-viewport]").filter({ has: search });
        await expect
          .poll(() =>
            viewport.evaluate((element) => {
              const size = element as unknown as { scrollWidth: number; clientWidth: number };
              return size.scrollWidth <= size.clientWidth + 1;
            }),
          )
          .toBe(true);
        await expect(search).toBeInViewport({ ratio: 1 });
        for (const source of ["Google Tasks", "Apple Reminders", "Calendar", "Gmail"]) {
          await expect(
            page.getByRole("checkbox", { name: `Show ${source}`, exact: true }).locator(".."),
          ).toBeInViewport({ ratio: 1 });
        }
        expect(
          await page.evaluate(() => {
            const browser = globalThis as unknown as {
              document: { documentElement: { scrollWidth: number } };
              innerWidth: number;
            };
            return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1;
          }),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            `agenda-${theme.toLowerCase()}-${density.toLowerCase()}-minimum-details.png`,
          ),
          animations: "disabled",
        });
        await details.getByRole("button", { name: "Close details", exact: true }).click();
        await expect(details).toHaveCount(0);
      }
    }
    for (let index = 0; index < 2; index++) {
      await navigate(page, "Tasks");
      await navigate(page, "Agenda");
      await page.getByRole("button", { name: "New task, reminder, or event" }).first().click();
      const capture = page.getByRole("dialog", { name: "New Item" });
      await expect(capture).toBeVisible();
      await capture.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(capture).toHaveCount(0);
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
