import { expect, test, type Page } from "@playwright/test";
import { launchDemo } from "./fixtures";

function sidebarItem(page: Page, title: string) {
  return page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

async function openInbox(page: Page) {
  await sidebarItem(page, "Inbox").click();
  await expect(sidebarItem(page, "Inbox")).toHaveAttribute("aria-current", "page");
}

test("Inbox shows triage chips and a summary card; E marks done, J and K move", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await openInbox(page);
    const priya = page.getByRole("button", {
      name: "Open email from Priya Shah",
    });
    await expect(priya).toContainText("Final-copy decision requested");

    // J and K move between emails; Enter opens the focused one.
    await page.locator("body").click({ position: { x: 700, y: 20 } });
    await page.keyboard.press("j");
    await expect(priya).toBeFocused();
    await page.keyboard.press("j");
    await expect(page.getByRole("button", { name: "Open email from Jordan Lee" })).toBeFocused();
    await page.keyboard.press("k");
    await expect(priya).toBeFocused();
    await page.keyboard.press("Enter");

    const detail = page.getByRole("dialog", {
      name: "Launch announcement — final copy?",
    });
    await expect(detail).toBeVisible();
    const summary = detail.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("Needs Reply");
    await expect(summary).toContainText("Final-copy decision requested");
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath("mail-summary.png") });

    // Demo mode refuses to change Gmail, so E reports the refusal and keeps the email.
    await page.keyboard.press("e");
    await expect(page.getByText(/Couldn't archive/)).toBeVisible();
    await expect(detail).toBeVisible();

    // R replies; the reply sends (with Undo) or saves a draft.
    await page.keyboard.press("r");
    await expect(detail).toHaveCount(0);
    const reply = page.getByRole("dialog", { name: "Reply to Priya Shah" });
    await expect(reply).toBeVisible();
    await expect(reply.getByRole("button", { name: "Save Draft" })).toBeVisible();
    const send = reply.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await reply.getByRole("textbox", { name: "Your reply" }).fill("Looks good to me.");
    await send.click();
    await expect(page.getByText(/Couldn't send: .*demo mode/)).toBeVisible();
    await expect(reply).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("C and ⌘K open a new email that checks its recipients and keeps the text", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await openInbox(page);
    await page.locator("body").click({ position: { x: 700, y: 20 } });
    await page.keyboard.press("c");
    const compose = page.getByRole("dialog", { name: "New Email" });
    await expect(compose).toBeVisible();
    await expect(compose.getByRole("textbox", { name: "To" })).toBeFocused();
    const send = compose.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await compose.getByRole("textbox", { name: "To" }).fill("sam@example.com");
    await compose.getByRole("textbox", { name: "Subject" }).fill("Lunch");
    await compose.getByRole("textbox", { name: "Message" }).fill("Thursday works.");
    await page.screenshot({ path: testInfo.outputPath("compose.png") });
    // ⌘↩ sends; demo mode refuses and the message stays for editing.
    await page.keyboard.press("Meta+Enter");
    await expect(compose.getByRole("alert")).toContainText("demo mode");
    await expect(compose.getByRole("textbox", { name: "Message" })).toHaveValue("Thursday works.");
    await page.keyboard.press("Escape");
    await expect(compose).toHaveCount(0);

    // The command menu offers it from anywhere.
    await sidebarItem(page, "Home").click();
    await page.keyboard.press("Meta+K");
    await page.keyboard.type("new email");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "New Email" })).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Remind me if no reply lists the email as waiting; S opens Snooze", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await openInbox(page);
    await page.getByRole("button", { name: "Open email from Sam Patel" }).click();
    const detail = page.getByRole("dialog", { name: "Lunch today?" });
    await expect(detail).toBeVisible();

    // S opens the snooze choices; demo mode refuses to move the email.
    await page.keyboard.press("s");
    const snoozeMenu = page.getByRole("menu");
    await expect(snoozeMenu.getByRole("menuitem", { name: /^Tomorrow/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("snooze-menu.png") });
    await snoozeMenu.getByRole("menuitem", { name: /^Tomorrow/ }).click();
    await expect(page.getByText(/Couldn't snooze: .*demo mode/)).toBeVisible();

    // Follow-ups stay on this Mac, so they work in demo mode.
    await detail.getByRole("button", { name: "Remind me" }).click();
    await page.getByRole("menuitem", { name: /^3 days/ }).click();
    await expect(
      page.getByText("DayBoard will remind you if nobody replies in 3 days"),
    ).toBeVisible();
    await expect(detail.getByRole("button", { name: "Waiting for reply · Cancel" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    const waiting = page.getByRole("region", { name: "Waiting for reply" });
    await expect(waiting).toContainText("Lunch today?");
    await waiting.getByRole("button", { name: "Stop waiting on Lunch today?" }).click();
    await expect(waiting).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Subscriptions lists newsletters with open rates and offers to unsubscribe", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await openInbox(page);
    await page.getByRole("button", { name: "Subscriptions" }).click();
    const dialog = page.getByRole("dialog", { name: "Subscriptions" });
    const senders = dialog.getByRole("list", { name: "Senders" });
    await expect(senders.getByRole("listitem")).toHaveCount(3);
    await expect(senders.getByRole("listitem").first()).toContainText("Design Weekly");
    await expect(senders.getByRole("listitem").first()).toContainText("3 of 12 opened");
    await page.screenshot({ path: testInfo.outputPath("subscriptions.png") });

    await dialog.getByRole("textbox", { name: "Search subscriptions" }).fill("launch");
    await expect(senders.getByRole("listitem")).toHaveCount(1);
    await expect(senders).toContainText("0 of 8 opened");

    // Demo mode never contacts a sender.
    await dialog.getByRole("button", { name: "Unsubscribe from Launch Notes" }).click();
    await expect(
      page.getByText(/Couldn't unsubscribe from Launch Notes: .*demo mode/),
    ).toBeVisible();
    await expect(senders.getByRole("listitem")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press("Meta+K");
    await page.keyboard.type("subscriptions");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Subscriptions" })).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
