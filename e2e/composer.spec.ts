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

async function assistantEffort(page: Page) {
  return page.evaluate(async () => {
    const settings = await (globalThis as AppGlobal).dayboard.ipc.invoke<{
      ai: { assistantEffort: Record<string, string> };
    }>("settings:get");
    return settings.ai.assistantEffort;
  });
}

async function openSettingsTab(app: ElectronApplication, page: Page, tab: string) {
  await page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"));
  await expect
    .poll(() => app.windows().find((window) => /settings-window/.test(window.url())))
    .not.toBeUndefined();
  const settings = app.windows().find((window) => /settings-window/.test(window.url()))!;
  await settings.waitForLoadState("domcontentloaded");
  await settings.getByRole("tab", { name: tab, exact: true }).click();
  return settings;
}

async function chooseClaudeModel(page: Page, from: string, model: RegExp) {
  await page.getByRole("button", { name: `Change model: ${from}` }).click();
  await page.getByRole("menuitem", { name: "✓ Claude" }).click();
  await page.getByRole("menuitemcheckbox", { name: model }).click();
}

test("effort panel sets the Assistant's effort, resets it and keeps Ultra out of reach", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    await navigate(demo.page, "Assistant");
    const chip = demo.page.getByRole("button", { name: /^Model and effort:/ });
    await expect(chip).toHaveAccessibleName(
      "Model and effort: Claude Code default, Default effort",
    );
    await chip.click();
    await expect(chip).toContainText("Select effort");
    const panel = demo.page.getByRole("dialog", { name: "Model and effort" });
    const slider = panel.getByRole("slider", { name: "Effort" });
    await expect(slider).toBeFocused();
    await expect(slider).toHaveAttribute("aria-valuetext", "Default");
    await expect(slider).toHaveAttribute("aria-valuemax", "4");
    const reset = panel.getByRole("button", { name: "Reset effort to the model default" });
    await expect(reset).toBeDisabled();

    await slider.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "Extra High");
    await expect(panel.getByText("Extra High", { exact: true })).toBeVisible();
    await expect.poll(() => assistantEffort(demo.page)).toEqual({ claude: "xhigh" });
    await slider.press("End");
    await slider.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "Max");
    await expect(slider).toHaveAttribute("aria-valuenow", "4");

    const ultra = panel.getByRole("img", { name: "Ultra, not available for this model" });
    await ultra.focus();
    await expect(demo.page.getByRole("tooltip")).toContainText(
      "Ultra is available with Codex on GPT-6 Astra, GPT-6 Sol, and GPT-5.6 Sol or Terra.",
    );
    await demo.page.screenshot({ path: testInfo.outputPath("effort-panel.png") });

    // Switching models keeps the effort where the new model has it and clears it where it doesn't.
    await chooseClaudeModel(demo.page, "Claude Code default", /^Opus\s*Latest/);
    await expect(slider).toHaveAttribute("aria-valuetext", "Max");
    const bolt = panel.getByRole("button", { name: "Fast mode" });
    await expect(bolt).toHaveAttribute("aria-pressed", "false");
    await bolt.click();
    await expect(bolt).toHaveAttribute("aria-pressed", "true");
    await chooseClaudeModel(demo.page, "Opus", /^Haiku/);
    await expect(panel).toContainText("This model doesn't have effort settings.");
    await expect(panel.getByRole("button", { name: "Fast mode" })).toHaveCount(0);
    await expect.poll(() => assistantEffort(demo.page)).toEqual({});
    await chooseClaudeModel(demo.page, "Haiku", /^Opus\s*Latest/);
    await expect(slider).toHaveAttribute("aria-valuetext", "Default");
    await slider.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", "Medium");
    await reset.click();
    await expect(slider).toHaveAttribute("aria-valuetext", "Default");
    await expect.poll(() => assistantEffort(demo.page)).toEqual({});

    await demo.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(chip).toHaveAccessibleName("Model and effort: Opus, Default effort, Fast");
    await expect(chip).not.toContainText("Select effort");

    const settings = await openSettingsTab(demo.app, demo.page, "AI");
    await expect(settings.getByText("Effort for AI features")).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("slash menu runs actions and prompts from the keyboard", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    await navigate(demo.page, "Assistant");
    const input = demo.page.getByRole("textbox", { name: /^Message / });
    await expect(demo.page.locator('[data-from="user"]')).toHaveCount(1);
    await input.fill("/");
    const list = demo.page.getByRole("listbox", { name: "Commands" });
    const newOption = list.getByRole("option", { name: /^\/new\b/ });
    await expect(newOption).toHaveAttribute("aria-selected", "true");
    await expect(list.getByRole("group", { name: "Actions" })).toBeVisible();
    await expect(list.getByRole("group", { name: "Prompts" })).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(input).toHaveAttribute("aria-controls", String(await list.getAttribute("id")));
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      String(await newOption.getAttribute("id")),
    );
    await demo.page.screenshot({ path: testInfo.outputPath("slash-menu.png") });
    await input.press("ArrowDown");
    await expect(list.getByRole("option", { name: /^\/history\b/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await input.press("ArrowUp");
    await input.press("Enter");
    await expect(demo.page.getByText("Ask About Your Day")).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(list).toHaveCount(0);

    // Enter while an input method is still composing neither picks nor sends.
    await input.fill("こんにちは");
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(input).toHaveValue("こんにちは");
    await expect(demo.page.locator('[data-from="user"]')).toHaveCount(0);

    await input.fill("/focus");
    await input.press("Tab");
    await expect(input).toHaveValue("What should I focus on for the rest of today?");
    await expect(list).toHaveCount(0);

    const chip = demo.page.getByRole("button", { name: /^Model and effort:/ });
    await input.fill("/effort extra high");
    await input.press("Enter");
    await expect(chip).toHaveAccessibleName(
      "Model and effort: Claude Code default, Extra High effort",
    );
    await input.fill("/effort ultra");
    await input.press("Enter");
    await expect(
      demo.page.getByText(
        "Ultra is available with Codex on GPT-6 Astra, GPT-6 Sol, and GPT-5.6 Sol or Terra.",
      ),
    ).toBeVisible();
    await expect(chip).toHaveAccessibleName(
      "Model and effort: Claude Code default, Extra High effort",
    );

    await input.fill("/mode auto");
    await input.press("Enter");
    await expect(demo.page.getByRole("button", { name: "Permissions: Auto" })).toBeVisible();
    await input.fill("/mode");
    await input.press("Enter");
    await expect(demo.page.getByRole("menuitemcheckbox", { name: /^Read only/ })).toBeVisible();
    await demo.page.keyboard.press("Escape");

    await input.fill("/model");
    await input.press("Enter");
    await expect(demo.page.getByRole("dialog", { name: "Model and effort" })).toBeVisible();
    await demo.page.keyboard.press("Escape");

    await input.fill("/history");
    await input.press("Enter");
    await expect(demo.page.getByRole("dialog", { name: "Chat history" })).toBeVisible();
    await demo.page.keyboard.press("Escape");

    await input.fill("/mcp");
    await input.press("Enter");
    await expect(demo.page.getByRole("dialog", { name: "MCP Servers" })).toBeVisible();
    await demo.page.keyboard.press("Escape");

    await input.fill("/attach");
    await expect(list).toHaveCount(0);

    await input.fill("/brief");
    await input.press("Enter");
    await expect(demo.page.locator('[data-from="user"]')).toContainText(
      "Give me a short briefing for today",
    );
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("@ mentions add a chip, and the sent message keeps it", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    await navigate(demo.page, "Assistant");
    await demo.page.getByRole("button", { name: "New chat" }).click();
    const input = demo.page.getByRole("textbox", { name: /^Message / });
    const list = demo.page.getByRole("listbox", { name: "Mentions" });
    await input.fill("bob@example.com");
    await expect(list).toHaveCount(0);
    await input.fill("Prep me for @lun");
    await expect(list.getByRole("option", { name: /^Lunch with Sam/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(list.getByRole("option", { name: /^Lunch today\?/ })).toBeVisible();
    await demo.page.screenshot({ path: testInfo.outputPath("mention-menu.png") });
    await input.press("Enter");
    await expect(input).toHaveValue("Prep me for ");
    await expect(list).toHaveCount(0);
    await expect(demo.page.getByRole("button", { name: "Remove Lunch with Sam" })).toBeVisible();
    await input.fill("Prep me for lunch");
    await demo.page.getByRole("button", { name: "Send", exact: true }).click();
    const user = demo.page.locator('[data-from="user"]');
    await expect(user).toContainText("Lunch with Sam");
    await expect(user).toContainText("Prep me for lunch");
    await expect(demo.page.getByRole("button", { name: "Remove Lunch with Sam" })).toHaveCount(0);
    await expect(demo.page.locator('[data-from="assistant"]')).toContainText("Sample answer");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
