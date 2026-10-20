import { expect, test, type Page } from "@playwright/test";

import { defaultSettings, openPanel, panelCalls } from "./panel-harness";

// What these cover: the panels' keyboard handling, IPC calls and design rules, rendered from the
// production build with the SDK's real components and styles. Native window behaviour (floating
// over full-screen apps, Spaces, the tray anchor on screen, focus returning to the previous app)
// still needs a hands-on check in the Glaze app.

const NOW = new Date(2026, 9, 20, 10, 0);
const at = (hours: number, minutes = 0) =>
  new Date(2026, 9, 20, hours, minutes).toISOString();

// Page globals, reached through globalThis inside page.evaluate callbacks.
type Dom = {
  dispatchEvent(event: unknown): boolean;
  Event: new (type: string) => unknown;
  document: { activeElement: { blur?: () => void } | null; documentElement: unknown };
  getComputedStyle(node: unknown): { backgroundColor: string; fontVariantNumeric: string };
};

/** The panel window regaining focus, as the main process does when it shows the panel. */
const reshow = (page: Page) =>
  page.evaluate(() => {
    const view = globalThis as unknown as Dom;
    view.dispatchEvent(new view.Event("focus"));
  });
const blurAll = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Dom).document.activeElement?.blur?.());
/** Alpha of the page ground: 1 is the solid popover surface, 0 a see-through window. */
const groundAlpha = (page: Page) =>
  page.evaluate(() => {
    const view = globalThis as unknown as Dom;
    const color = view.getComputedStyle(view.document.documentElement).backgroundColor;
    if (color === "transparent") return 0;
    const alpha = color.match(/\/\s*([\d.]+)\)$/) ?? color.match(/^rgba\(.*,\s*([\d.]+)\)$/);
    return alpha ? Number(alpha[1]) : 1;
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test.describe("Quick Capture panel", () => {
  test("Escape hides the panel even when nothing inside is focused", async ({ page }) => {
    await openPanel(page, "capture", { settings: await defaultSettings() });
    const input = page.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toBeVisible();
    await blurAll(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => panelCalls(page, "panel:hide")).toEqual([
      { channel: "panel:hide", args: [{ surface: "capture" }] },
    ]);
  });

  test("the first keystrokes after each way it opens land in the field", async ({ page }) => {
    await openPanel(page, "capture", {
      settings: await defaultSettings(),
      reject: { "capture:submit": "Google Tasks isn't connected." },
    });
    const input = page.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toBeFocused();
    // First show: type without clicking.
    await page.keyboard.type("Call dentist");
    await expect(input).toHaveValue("Call dentist");
    // After Escape, then shown again.
    await page.keyboard.press("Escape");
    await blurAll(page);
    await reshow(page);
    await expect(input).toBeFocused();
    await page.keyboard.type(" Thursday");
    await expect(input).toHaveValue("Call dentist Thursday");
    // After a click-away, then shown again.
    await blurAll(page);
    await reshow(page);
    await page.keyboard.type(" 3pm");
    await expect(input).toHaveValue("Call dentist Thursday 3pm");
    // After a rejected submit, the panel comes back with the field ready.
    await page.keyboard.press("Enter");
    await expect(page.getByText("Google Tasks isn't connected.")).toBeVisible();
    await reshow(page);
    await page.keyboard.type("Buy milk");
    await expect(input).toHaveValue("Buy milk");
  });

  test("follows the design system's ground, placeholder and failure rules", async ({ page }) => {
    await openPanel(page, "capture", {
      settings: await defaultSettings(),
      reject: { "capture:submit": "Google Tasks isn't connected." },
    });
    expect(await groundAlpha(page)).toBe(1);
    const input = page.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toHaveAttribute("placeholder", /…$/);
    await input.fill("Call dentist Thursday 3pm");
    await input.press("Enter");
    const failure = page.getByText("Google Tasks isn't connected.");
    await expect(failure).toBeVisible();
    expect(
      await failure.evaluate(
        (node) => node.closest("[class*='bg-support-']")?.getAttribute("class") ?? "",
      ),
    ).toContain("bg-support-red");
  });
});

test.describe("Menu-bar panel", () => {
  const event = {
    id: "standup",
    title: "Design review with the whole product team for the panels",
    start: at(11),
    end: at(11, 30),
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
    calendarId: "primary",
    calendarName: "Calendar",
    calendarColor: null,
    attendees: [],
  };

  test("Escape hides the panel even when nothing inside is focused", async ({ page }) => {
    await openPanel(page, "menubar", { settings: await defaultSettings() });
    await expect(page.getByRole("textbox", { name: "Add or ask" })).toBeVisible();
    await blurAll(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => panelCalls(page, "panel:hide")).toEqual([
      { channel: "panel:hide", args: [{ surface: "menubar" }] },
    ]);
  });

  test("follows the design system's ground, row and placeholder rules", async ({ page }) => {
    await openPanel(page, "menubar", {
      settings: await defaultSettings(),
      responses: { "calendar:listRange": { state: "ok", items: [event] } },
    });
    expect(await groundAlpha(page)).toBe(1);
    await expect(page.getByRole("textbox", { name: "Add or ask" })).toHaveAttribute(
      "placeholder",
      /^.{1,32}…$/,
    );
    const row = page.getByRole("region", { name: "Today's items" }).getByRole("button").first();
    await expect(row).toContainText(event.title);
    expect(await row.getAttribute("class")).toContain("hover:bg-list-hover");
    const title = row.locator("span").last();
    await expect(title).toHaveAttribute("title", event.title);
    const time = row.locator("span").nth(1);
    expect(
      await time.evaluate(
        (node) => (globalThis as unknown as Dom).getComputedStyle(node).fontVariantNumeric,
      ),
    ).toContain(
      "tabular-nums",
    );
  });
});
