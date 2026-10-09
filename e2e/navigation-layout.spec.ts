import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestProfile, launchDemo } from "./fixtures";

const routes = ["Agenda", "Calendar", "Tasks", "Reminders", "Inbox", "Assistant", "Weekly Review"];
const sizes = [
  { width: 800, height: 600 },
  { width: 1100, height: 800 },
  { width: 1280, height: 820 },
];

interface LayoutElement {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  textContent: string | null;
  getBoundingClientRect(): { left: number; right: number };
  getAttribute(name: string): string | null;
  closest(selector: string): LayoutElement;
  querySelectorAll(selector: string): LayoutElement[];
}

async function navigate(page: Page, route: string) {
  const button = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button")
    .filter({ has: page.getByText(route, { exact: true }) });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-page-header] h1")).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  for (const density of ["default", "compact"] as const) {
    test(`${theme} ${density}: main page headers and navigation fit supported window sizes`, async ({
      playwright: _playwright,
    }, testInfo) => {
      const profile = await createTestProfile();
      await writeFile(
        path.join(profile, "demo-settings.json"),
        JSON.stringify({ general: { density, accent: "blue" } }),
      );
      const demo = await launchDemo(profile);
      try {
        await demo.app.evaluate(
          ({ nativeTheme }, scheme) => (nativeTheme.themeSource = scheme),
          theme,
        );
        await demo.page.emulateMedia({ colorScheme: theme });
        await expect(
          demo.page.getByRole("button", { name: "Profile menu for Alex Rivera" }),
        ).toBeVisible();
        for (const size of sizes) {
          await demo.app.evaluate(({ BrowserWindow }, dimensions) => {
            BrowserWindow.getAllWindows()[0].setContentSize(dimensions.width, dimensions.height);
          }, size);
          for (const route of routes) {
            await navigate(demo.page, route);
            const layout = await demo.page.evaluate(() => {
              const browser = globalThis as unknown as {
                document: {
                  querySelector(selector: string): LayoutElement;
                  documentElement: { scrollWidth: number };
                };
                innerWidth: number;
                getComputedStyle(element: LayoutElement): { fontSize: string };
              };
              const heading = browser.document.querySelector("[data-page-header] h1");
              const header = heading.closest("[data-page-header]")!;
              const title = heading.getBoundingClientRect();
              const controls = Array.from(header.querySelectorAll("button")).map((button) => {
                const bounds = button.getBoundingClientRect();
                return {
                  name: button.getAttribute("aria-label") ?? button.textContent,
                  left: bounds.left,
                  right: bounds.right,
                };
              });
              const history = browser.document
                .querySelector('[aria-label="Page history"]')
                .getBoundingClientRect();
              return {
                titleClipped:
                  heading.scrollWidth > heading.clientWidth + 1 ||
                  heading.scrollHeight > heading.clientHeight + 1,
                titleRight: title.right,
                titleSize: browser.getComputedStyle(heading).fontSize,
                viewport: browser.innerWidth,
                documentWidth: browser.document.documentElement.scrollWidth,
                historyLeft: history.left,
                historyRight: history.right,
                controls,
              };
            });
            expect(layout.titleSize).toBe("24px");
            expect(layout.titleClipped, `${route} title clips at ${size.width}`).toBe(false);
            expect(layout.titleRight).toBeLessThanOrEqual(layout.viewport);
            expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
            expect(layout.historyLeft).toBeGreaterThan(80);
            expect(layout.historyRight).toBeLessThan(layout.viewport);
            for (const control of layout.controls) {
              expect(control.left, `${route}: ${control.name}`).toBeGreaterThanOrEqual(0);
              expect(control.right, `${route}: ${control.name}`).toBeLessThanOrEqual(
                layout.viewport,
              );
            }
          }
          if (size.width === 800) {
            await navigate(demo.page, "Calendar");
            await demo.page.getByRole("radio", { name: "Week", exact: true }).click();
            await expect(demo.page.locator("[data-calendar-hours]")).toBeVisible();
            await expect(demo.page.getByText("Mon", { exact: true })).toBeVisible();
            await expect(demo.page.locator('[data-calendar-hour-label="7"]')).toBeInViewport({
              ratio: 1,
            });
            const outerScrolls = await demo.page
              .locator("[data-radix-scroll-area-viewport]")
              .evaluate((element) => element.scrollHeight > element.clientHeight + 1);
            expect(outerScrolls).toBe(false);
            await demo.page.screenshot({
              path: testInfo.outputPath(`${theme}-${density}-800-calendar.png`),
            });
          }
        }
        expect(demo.errors).toEqual([]);
      } finally {
        await demo.close();
      }
    });
  }
}

test("window history and sidebar remain usable through keyboard navigation and dialogs", async ({
  playwright: _playwright,
}) => {
  const demo = await launchDemo();
  try {
    await navigate(demo.page, "Tasks");
    await navigate(demo.page, "Calendar");
    await navigate(demo.page, "Assistant");
    const history = demo.page.getByRole("group", { name: "Page history" });
    await history.getByRole("button", { name: "Back", exact: true }).click();
    await expect(demo.page.locator("[data-page-header] h1")).toHaveText("Calendar");
    await history.getByRole("button", { name: "Back", exact: true }).focus();
    await demo.page.keyboard.press("Enter");
    await expect(demo.page.locator("[data-page-header] h1")).toContainText("Tasks");
    await demo.page.keyboard.press("Meta+BracketRight");
    await expect(demo.page.locator("[data-page-header] h1")).toHaveText("Calendar");
    await history.getByRole("button", { name: "Forward", exact: true }).click();
    await expect(demo.page.locator("[data-page-header] h1")).toHaveText("Assistant");

    const toggle = demo.page.getByRole("button", { name: "Hide Sidebar", exact: true });
    const before = await toggle.boundingBox();
    await demo.page.keyboard.press("Control+Meta+S");
    const show = demo.page.getByRole("button", { name: "Show Sidebar", exact: true });
    await expect(show).toBeVisible();
    const after = await show.boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    await show.click();
    await expect(toggle).toBeVisible();

    await demo.page.keyboard.press("Meta+N");
    const dialog = demo.page.getByRole("dialog", { name: "New Item", exact: true });
    await expect(dialog).toBeVisible();
    await demo.page.keyboard.press("Control+Meta+S");
    await expect(demo.page.locator('button[aria-label="Hide Sidebar"]')).toBeVisible();
    await demo.page.keyboard.press("Meta+BracketLeft");
    await expect(demo.page.locator("[data-page-header] h1")).toHaveText("Assistant");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await demo.page.keyboard.press("Meta+N");
    await expect(dialog).toBeVisible();
    await demo.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
