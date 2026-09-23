import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { launchDemo } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

async function navigate(page: Page, route: string) {
  const button = page
    .getByRole("button")
    .filter({ has: page.getByText(route, { exact: true }) })
    .first();
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

async function openSettings(app: ElectronApplication, page: Page) {
  await page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"));
  await expect
    .poll(() => app.windows().find((window) => /settings-window/.test(window.url())))
    .not.toBeUndefined();
  const settings = app.windows().find((window) => /settings-window/.test(window.url()))!;
  await settings.waitForLoadState("domcontentloaded");
  await settings.getByRole("tab", { name: "General", exact: true }).click();
  return settings;
}

async function setDetailView(settings: Page, page: Page, label: string, value: string) {
  await settings.getByRole("radio", { name: label, exact: true }).click();
  await expect(settings.getByRole("radio", { name: label, exact: true })).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const data = await (globalThis as AppGlobal).dayboard.ipc.invoke<{
          general: { detailView: string };
        }>("settings:get");
        return data.general.detailView;
      }),
    )
    .toBe(value);
}

test("fictional email opens with its full body in each detail presentation", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const settings = await openSettings(demo.app, demo.page);
    await navigate(demo.page, "Inbox");
    const row = demo.page.getByRole("button", { name: "Open email from Priya Shah", exact: true });
    const subject = "Launch announcement — final copy?";
    const fullBody = "Hi Alex,";

    await row.click();
    const dialog = demo.page.getByRole("dialog", { name: subject });
    await expect(dialog).toContainText(fullBody);
    await expect(dialog).toContainText("Thanks, Priya Shah");
    await demo.page.screenshot({ path: testInfo.outputPath("mail-dialog.png") });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    await setDetailView(settings, demo.page, "Inline", "inline");
    await row.focus();
    await row.press("Enter");
    const inline = demo.page.getByRole("region", { name: `${subject} details` });
    await expect(inline).toContainText(fullBody);
    await expect(inline).toContainText("Thanks, Priya Shah");
    await demo.page.screenshot({ path: testInfo.outputPath("mail-inline.png") });
    await inline.getByRole("button", { name: "Close details" }).click();
    await expect(inline).toHaveCount(0);

    await setDetailView(settings, demo.page, "Side panel", "sidebar");
    await demo.page.setViewportSize({ width: 760, height: 640 });
    await row.click();
    const aside = demo.page.getByRole("complementary", { name: "Email details" });
    await expect(aside).toContainText(fullBody);
    await expect(aside).toContainText("Thanks, Priya Shah");
    expect(
      await demo.page.evaluate(() => {
        const browser = globalThis as unknown as {
          document: { documentElement: { scrollWidth: number } };
          innerWidth: number;
        };
        return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1;
      }),
    ).toBe(true);
    await demo.page.screenshot({ path: testInfo.outputPath("mail-side-panel-narrow.png") });
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("task and reminder details expose their data while demo editing stays read-only", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    await navigate(demo.page, "Tasks");
    await demo.page
      .getByRole("button", { name: "Open Finalize launch announcement", exact: true })
      .click();
    const task = demo.page.getByRole("dialog", { name: "Finalize launch announcement" });
    await expect(task).toContainText("Share draft with Priya before 3 PM");
    await expect(task).toContainText("Google Tasks");
    await task.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = demo.page.getByRole("dialog", { name: "Edit item" });
    await expect(editor).toContainText("Demo content is read-only");
    await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(editor.getByRole("textbox", { name: "Title" })).toBeDisabled();
    await demo.page.screenshot({ path: testInfo.outputPath("task-demo-editor.png") });
    await editor.getByRole("button", { name: "Cancel" }).click();
    await task.getByRole("button", { name: "Done" }).click();

    await navigate(demo.page, "Reminders");
    await demo.page.getByRole("button", { name: "Open Pick up dry cleaning" }).click();
    const reminder = demo.page.getByRole("dialog", { name: "Pick up dry cleaning" });
    await expect(reminder).toContainText("Apple Reminders");
    await expect(reminder).toContainText("5:30");
    await reminder.getByRole("button", { name: "Edit", exact: true }).click();
    const reminderEditor = demo.page.getByRole("dialog", { name: "Edit item" });
    await expect(reminderEditor).toContainText("Demo content is read-only");
    await expect(reminderEditor.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(reminderEditor.getByRole("textbox", { name: "Title" })).toBeDisabled();
    await demo.page.screenshot({ path: testInfo.outputPath("reminder-demo-editor.png") });
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Assistant composer answers locally and saves a conversation across relaunch", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  let relaunch: Awaited<ReturnType<typeof launchDemo>> | undefined;
  const question = "What should I focus on for the launch announcement?";
  try {
    await navigate(demo.page, "Assistant");
    await demo.page.getByRole("button", { name: "New chat" }).click();
    await expect(demo.page.getByText("Ask About Your Day")).toBeVisible();
    await demo.page.getByRole("textbox", { name: /^Message / }).fill(question);
    await demo.page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(demo.page.locator('[data-from="user"]')).toContainText(question);
    await expect(demo.page.locator('[data-from="assistant"]')).toContainText("Sample answer");
    await expect(demo.page.locator('[data-from="assistant"]')).toContainText(
      "Prioritize the launch announcement",
    );
    await expect(demo.page.getByText("Saved on this Mac")).toBeVisible();
    await demo.page.screenshot({ path: testInfo.outputPath("assistant-local-answer.png") });
    await demo.close(false);

    relaunch = await launchDemo(demo.profile);
    await navigate(relaunch.page, "Assistant");
    await expect(relaunch.page.locator('[data-from="user"]')).toContainText(question);
    await expect(relaunch.page.locator('[data-from="assistant"]')).toContainText(
      "Prioritize the launch announcement",
    );
    await relaunch.page.getByRole("button", { name: "Chat history" }).click();
    const history = relaunch.page.getByRole("dialog", { name: "Chat history" });
    await history.getByRole("textbox", { name: "Search chat history" }).fill("launch announcement");
    await expect(history.getByRole("button", { name: /What should I focus on/ })).toBeVisible();
    await relaunch.page.screenshot({ path: testInfo.outputPath("assistant-history-relaunch.png") });
    expect([...demo.errors, ...relaunch.errors]).toEqual([]);
  } finally {
    if (relaunch) await relaunch.close();
    else if (demo.app.process().exitCode === null) await demo.close();
  }
});

test("focus selection persists in the disposable demo profile", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  let relaunch: Awaited<ReturnType<typeof launchDemo>> | undefined;
  try {
    await navigate(demo.page, "Tasks");
    const row = demo.page.getByRole("button", {
      name: "Open Finalize launch announcement",
      exact: true,
    });
    await row.focus();
    await row.press(" ");
    const detail = demo.page.getByRole("dialog", { name: "Finalize launch announcement" });
    await expect(detail).toBeVisible();
    await detail.getByRole("checkbox", { name: /^Focus/ }).click();
    await expect(detail.getByRole("checkbox", { name: /^Focus/ })).toBeChecked();
    await demo.page.screenshot({ path: testInfo.outputPath("focus-selected.png") });
    await demo.close(false);

    relaunch = await launchDemo(demo.profile);
    await navigate(relaunch.page, "Tasks");
    await relaunch.page
      .getByRole("button", { name: "Open Finalize launch announcement", exact: true })
      .click();
    await expect(
      relaunch.page
        .getByRole("dialog", { name: "Finalize launch announcement" })
        .getByRole("checkbox", { name: /^Focus/ }),
    ).toBeChecked();
    expect([...demo.errors, ...relaunch.errors]).toEqual([]);
  } finally {
    if (relaunch) await relaunch.close();
    else if (demo.app.process().exitCode === null) await demo.close();
  }
});
