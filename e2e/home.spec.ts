import { expect, test, type Page } from "@playwright/test";
import { launchDemo } from "./fixtures";

function sidebarItem(page: Page, title: string) {
  return page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

test("Home greets, ranks what needs you, suggests tasks from mail and lists meetings", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await expect(sidebarItem(page, "Home")).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /^Good (morning|afternoon|evening), Alex$/,
      }),
    ).toBeVisible();

    const needsYou = page.getByRole("region", { name: "Needs you" });
    const suggested = page.getByRole("region", { name: "Suggested" });
    const meetings = page.getByRole("region", { name: "Meetings" });
    const tasks = page.getByRole("region", { name: "Your tasks" });

    // New mail is triaged on its own: what needs a reply stays, FYI mail drops out.
    const sam = needsYou.getByRole("button", {
      name: /^Sam Patel: Lunch today\?, Confirm lunch plans/,
    });
    await expect(sam).toBeVisible();
    await expect(
      needsYou.getByRole("button", {
        name: /^Priya Shah: Launch announcement.*Final-copy decision requested/,
      }),
    ).toBeVisible();
    await expect(needsYou.getByRole("button", { name: /^Jordan Lee:/ })).toHaveCount(0);
    await expect(needsYou.getByRole("button", { name: "Review inbox" })).toHaveCount(0);
    await expect(suggested.getByText("Review launch copy", { exact: true })).toBeVisible();
    await expect(suggested.getByText("Submit the Q4 budget", { exact: true })).toBeVisible();

    await suggested
      .getByRole("button", { name: "Dismiss suggestion: Submit the Q4 budget" })
      .click();
    await expect(suggested.getByText("Submit the Q4 budget", { exact: true })).toHaveCount(0);

    await expect(meetings.getByRole("button", { name: /Team standup/ })).toBeVisible();
    await expect(tasks.getByText("Finalize launch announcement", { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath("home-today.png") });

    await page.getByRole("radio", { name: "This week" }).click();
    await expect(page.getByText(/meetings? this week\.$/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home-week.png") });

    // A waiting email opens in the Inbox.
    await sam.click();
    await expect(page.getByRole("dialog", { name: "Lunch today?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sidebarItem(page, "Inbox")).toHaveAttribute("aria-current", "page");

    // The full Agenda keeps its own place in the sidebar.
    await sidebarItem(page, "Agenda").click();
    await expect(sidebarItem(page, "Agenda")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-agenda-range]")).toBeVisible();

    // Home remembers the range and the dismissed suggestion.
    await sidebarItem(page, "Home").click();
    await expect(page.getByRole("radio", { name: "This week" })).toBeChecked();
    await expect(suggested.getByText("Review launch copy", { exact: true })).toBeVisible();
    await expect(suggested.getByText("Submit the Q4 budget", { exact: true })).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
