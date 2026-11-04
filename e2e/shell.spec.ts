import { expect, test, type Page } from "@playwright/test";
import { launchDemo } from "./fixtures";

function sidebarItem(page: Page, title: string) {
  return page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

async function navigate(page: Page, route: string) {
  const button = sidebarItem(page, route);
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

test("⌘K jumps to views and items, runs actions, and hands a question to the Assistant", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const menu = demo.page.getByRole("dialog", { name: "Command menu" });
    await navigate(demo.page, "Agenda");
    await demo.page.keyboard.press("Meta+K");
    await expect(menu).toBeVisible();
    await demo.page.screenshot({
      path: testInfo.outputPath("command-menu.png"),
    });
    await demo.page.keyboard.type("inbox");
    await demo.page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(sidebarItem(demo.page, "Inbox")).toHaveAttribute("aria-current", "page");

    // ⌘K again closes the menu it opened.
    await demo.page.keyboard.press("Meta+K");
    await expect(menu).toBeVisible();
    await demo.page.keyboard.press("Meta+K");
    await expect(menu).toHaveCount(0);

    // Items are searchable and open where their details live.
    await navigate(demo.page, "Agenda");
    await demo.page.keyboard.press("Meta+K");
    await demo.page.keyboard.type("Lunch today");
    const found = menu.getByRole("option", { name: /Lunch today\?/ });
    await expect(found).toBeVisible();
    await found.click();
    const detail = demo.page.getByRole("dialog", { name: "Lunch today?" });
    await expect(detail).toBeVisible();
    await demo.page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(sidebarItem(demo.page, "Inbox")).toHaveAttribute("aria-current", "page");

    // Actions run from the menu.
    await demo.page.keyboard.press("Meta+K");
    await demo.page.keyboard.type("keyboard shortcuts");
    await demo.page.keyboard.press("Enter");
    const sheet = demo.page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(sheet).toBeVisible();
    await demo.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Tab hands the typed question to the docked Assistant, which sends it once.
    await demo.page.keyboard.press("Meta+K");
    await demo.page.keyboard.type("What should I focus on?");
    await demo.page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
    const panel = demo.page.getByRole("complementary", { name: "Assistant" });
    await expect(panel).toBeVisible();
    const lastUser = panel.locator('[data-from="user"]').last();
    await expect(lastUser).toContainText("What should I focus on?");
    await expect(panel.locator('[data-from="assistant"]').last()).toContainText("Sample answer");
    await expect(panel.getByText("What should I focus on?", { exact: true })).toHaveCount(1);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("⌥⌘J docks the Assistant beside any view and attaches the open email", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const panel = demo.page.getByRole("complementary", { name: "Assistant" });
    const chip = panel.getByRole("button", { name: "Remove Lunch today?" });
    const catchUp = panel.getByRole("button", {
      name: "Catch me up on “Lunch today?”",
    });
    const detail = demo.page.getByRole("dialog", { name: "Lunch today?" });
    const openLunch = () =>
      demo.page.getByRole("button", { name: "Open email from Sam Patel" }).click();

    await navigate(demo.page, "Inbox");
    await openLunch();
    await expect(detail).toBeVisible();
    // A detail dialog keeps the shortcut; closing it leaves the email as the view's context.
    await demo.page.keyboard.press("Meta+Alt+J");
    await expect(panel).toHaveCount(0);
    await demo.page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    await demo.page.keyboard.press("Meta+Alt+J");
    await expect(panel).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(catchUp).toBeVisible();
    await demo.page.screenshot({
      path: testInfo.outputPath("agent-panel.png"),
    });

    // The panel stays open across views, and the header button reflects it.
    await navigate(demo.page, "Tasks");
    await expect(panel).toBeVisible();
    const ask = demo.page.getByRole("button", { name: "Ask Assistant" });
    await expect(ask).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toHaveCount(0);
    await ask.click();
    await expect(panel).toHaveCount(0);

    // Leaving a view drops its email; opening one again attaches it, and sending carries it.
    await navigate(demo.page, "Inbox");
    await ask.click();
    await expect(panel).toBeVisible();
    await expect(chip).toHaveCount(0);
    await openLunch();
    await expect(detail).toBeVisible();
    await demo.page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(chip).toBeVisible();
    await catchUp.click();
    await expect(panel.locator('[data-from="user"]').last()).toContainText("Lunch today?");
    await expect(panel.locator('[data-from="assistant"]').last()).toContainText("Sample answer");
    await expect(chip).toHaveCount(0);

    // The full Assistant page hides the panel rather than mounting a second chat.
    await navigate(demo.page, "Assistant");
    await expect(panel).toHaveCount(0);
    await expect(demo.page.locator('[data-from="user"]').last()).toContainText(
      "Catch me up on “Lunch today?”",
    );
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("⌥⌘K shows a day calendar beside the page; ? lists shortcuts; ⌃ numbers switch views", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const calendar = demo.page.getByRole("complementary", { name: "Calendar" });
    await navigate(demo.page, "Inbox");
    await demo.page.keyboard.press("Meta+Alt+K");
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole("group", { name: "Days" }).getByRole("button")).toHaveCount(7);
    await demo.page.screenshot({
      path: testInfo.outputPath("calendar-peek.png"),
    });
    // Calendar and Assistant share one pane.
    await demo.page.keyboard.press("Meta+Alt+J");
    await expect(calendar).toHaveCount(0);
    await expect(demo.page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
    await demo.page.keyboard.press("Meta+Alt+J");
    await expect(demo.page.getByRole("complementary")).toHaveCount(0);

    await demo.page.keyboard.press("Shift+Slash");
    const sheet = demo.page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Command menu");
    await expect(sheet).toContainText("Inbox");
    await demo.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await demo.page.keyboard.press("Control+Digit1");
    await expect(sidebarItem(demo.page, "Home")).toHaveAttribute("aria-current", "page");
    await demo.page.keyboard.press("Control+Digit4");
    await expect(sidebarItem(demo.page, "Inbox")).toHaveAttribute("aria-current", "page");

    // Typing ? into a field types it.
    await navigate(demo.page, "Assistant");
    const input = demo.page.getByRole("textbox", { name: /^Message / });
    await input.focus();
    await demo.page.keyboard.type("why?");
    await expect(input).toHaveValue("why?");
    await expect(sheet).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
