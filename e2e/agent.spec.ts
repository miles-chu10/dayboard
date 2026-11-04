import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { launchDemo } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

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

async function openSettings(app: ElectronApplication, page: Page, tab: string) {
  await page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"));
  await expect
    .poll(() => app.windows().find((window) => /settings-window/.test(window.url())))
    .not.toBeUndefined();
  const settings = app.windows().find((window) => /settings-window/.test(window.url()))!;
  await settings.waitForLoadState("domcontentloaded");
  await settings.getByRole("tab", { name: tab, exact: true }).click();
  return settings;
}

test("Notes lists, creates, autosaves, reopens and deletes notes", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await expect(sidebarItem(page, "Notes")).toContainText("2 notes");
    await navigate(page, "Notes");
    const list = page.getByRole("list", { name: "Notes" });
    await expect(list.getByRole("button", { name: /^Launch checklist/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^1:1 topics for Jordan/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("notes-list.png") });

    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Note", exact: true })
      .fill("# Offsite\n- Book the venue");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(
      page.getByRole("region", { name: "Note preview" }).getByRole("heading", { name: "Offsite" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("notes-editor.png") });
    await page.getByRole("button", { name: "All notes" }).click();

    // Newest edit first, with its title taken from the first line.
    await expect(list.getByRole("button").first()).toContainText("Offsite");
    await expect(sidebarItem(page, "Notes")).toContainText("3 notes");
    await page.getByRole("textbox", { name: "Search notes" }).fill("venue");
    await expect(list.getByRole("button")).toHaveCount(1);
    await list.getByRole("button", { name: /^Offsite/ }).click();
    await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue(
      "# Offsite\n- Book the venue",
    );

    // Typing then leaving straight away still saves.
    await page.getByRole("textbox", { name: "Note title" }).fill("Team offsite");
    await page.getByRole("button", { name: "All notes" }).click();
    await page.getByRole("textbox", { name: "Search notes" }).fill("");
    await expect(list.getByRole("button").first()).toContainText("Team offsite");

    await list.getByRole("button", { name: /^Team offsite/ }).click();
    await page.getByRole("button", { name: "Delete note" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(list.getByRole("button", { name: /^Team offsite/ })).toHaveCount(0);
    await expect(sidebarItem(page, "Notes")).toContainText("2 notes");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("⌘K finds a note by title and starts a new one", async () => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    const menu = page.getByRole("dialog", { name: "Command menu" });
    await expect(sidebarItem(page, "Home")).toBeVisible();
    await page.keyboard.press("Meta+K");
    await page.keyboard.type("launch check");
    await menu.getByRole("option", { name: "Launch checklist" }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Launch checklist");

    await page.keyboard.press("Meta+K");
    await page.keyboard.type("new note");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("");
    await expect(page.getByText("New note", { exact: true })).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("an Assistant chat saves as a note", async () => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await navigate(page, "Assistant");
    const input = page.getByRole("textbox", { name: /^Message / });
    await input.fill("What's on my plate today?");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Save chat as note" })).toBeEnabled();
    await page.getByRole("button", { name: "Save chat as note" }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const body = page.getByRole("textbox", { name: "Note", exact: true });
    await expect(body).toHaveValue(/Saved from the Assistant/);
    await expect(body).toHaveValue(/\*\*You:\*\* What's on my plate today\?/);
    await expect(body).toHaveValue(/\*\*Assistant:\*\* /);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Settings shows memory, usage and agent activity, and memory can be added, learned and forgotten", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const ai = await openSettings(demo.app, demo.page, "AI");
    const memories = ai.getByRole("list", { name: "Memories" });
    await expect(memories).toContainText("I prefer short replies, three sentences at most.");
    await expect(memories).toContainText("Learned from your edits");
    await expect(ai.getByRole("switch", { name: "Use memory" })).toBeChecked();

    await ai.getByRole("textbox", { name: "New memory" }).fill("Call me Alex, not Alexander");
    await ai.getByRole("button", { name: "Remember", exact: true }).click();
    await expect(memories.getByText("Call me Alex, not Alexander")).toBeVisible();
    await expect(ai.getByRole("textbox", { name: "New memory" })).toHaveValue("");

    // Edits to a reply draft teach a preference (the demo answers with a fixed one).
    const learned = await demo.page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke<{ learned: string | null }>("memory:learn", {
        draft: "Hi Sam, thanks so much for reaching out about lunch! Today works great.",
        sent: "Today works.",
      }),
    );
    expect(learned.learned).toBe("Skip the greeting and get straight to the point.");
    // A learned preference is only a suggestion until the user confirms it.
    await expect(
      memories.getByText("Skip the greeting and get straight to the point."),
    ).toHaveCount(0);
    await demo.page.evaluate(
      (text) =>
        (globalThis as AppGlobal).dayboard.ipc.invoke("memory:add", { text, source: "learned" }),
      learned.learned,
    );
    await expect(
      memories.getByText("Skip the greeting and get straight to the point."),
    ).toBeVisible();

    await ai.getByRole("button", { name: "Forget: Call me Alex, not Alexander" }).click();
    await expect(memories.getByText("Call me Alex, not Alexander")).toHaveCount(0);

    await expect(ai.getByRole("img", { name: /Requests per day/ })).toBeVisible();
    const byModel = ai.getByRole("table", { name: "Usage by model" });
    await expect(byModel).toContainText("claude-sonnet-5-5");
    await expect(byModel).toContainText("gpt-5.6-sol");
    await byModel.scrollIntoViewIfNeeded();
    await ai.screenshot({
      path: testInfo.outputPath("settings-memory-usage.png"),
    });

    await ai.getByRole("tab", { name: "MCP Servers", exact: true }).click();
    const activity = ai.getByRole("list", { name: "Agent activity" });
    await expect(activity).toContainText("create_task");
    await expect(activity).toContainText("Reminder not found");
    await expect(activity.getByText("Failed", { exact: true })).toBeVisible();
    await expect(activity.getByRole("listitem")).toHaveCount(5);
    await ai.getByRole("switch", { name: "Show changes only" }).click();
    await expect(activity.getByRole("listitem")).toHaveCount(2);
    await expect(activity).not.toContainText("list_inbox");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
