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
