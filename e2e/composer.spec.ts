import { expect, test } from "@playwright/test";
import type { AppSettings, CodexModelInfo } from "../main/shared-types";
import { defaultSettings, openMain, panelCalls } from "./panel-harness";

const NOW = new Date(2026, 9, 20, 10, 0);

async function assistantSettings(provider: "claude" | "codex") {
  const settings = (await defaultSettings()) as unknown as AppSettings;
  settings.general.launchView = "assistant";
  settings.general.refreshMinutes = 0;
  settings.ai.enabled = true;
  settings.ai.provider = provider;
  settings.ai.assistantProvider = "";
  settings.ai.features.assistant = true;
  settings.ai.useMcpInAssistant = false;
  return settings;
}

for (const theme of ["light", "dark"] as const) {
  test(`Claude default needs no key and records the actual reply model in ${theme}`, async ({
    page,
  }, info) => {
    await page.clock.setFixedTime(NOW);
    await page.emulateMedia({ colorScheme: theme });
    const settings = await assistantSettings("claude");
    settings.ai.claudeModel = "default";
    settings.ai.assistantEffort = { claude: "max" };
    await openMain(page, {
      settings: settings as unknown as Record<string, unknown>,
      responses: {
        "ai:availability": { glaze: true, claude: true },
        "ai:assistant": {
          text: "Offline synthetic reply.",
          model: {
            provider: "claude",
            id: "claude-opus-5-5",
            name: "Claude Opus 5.5",
            via: "Claude Code",
            effort: null,
            effortLabel: "Claude Code's effort",
            fast: false,
            contextWindow: null,
          },
        },
      },
    });
    const input = page.getByRole("textbox", { name: "Message Claude" });
    await expect(input).toBeVisible();
    const chip = page.getByRole("button", { name: /^Model and effort:/ });
    await expect(chip).toHaveAttribute("title", "Claude Code default");
    await chip.click();
    const panel = page.getByRole("dialog", { name: "Model and effort" });
    await expect(panel.getByRole("slider")).toHaveCount(0);
    await expect(panel.getByText(/Choose a model to set effort/)).toBeVisible();
    await panel.getByText(/Choose a model to set effort/).click();
    await page.keyboard.press("Escape");
    await expect(chip).toBeFocused();
    await input.fill("Hello from the offline fixture");
    await input.press("Enter");
    await expect(page.getByText("Offline synthetic reply.", { exact: true })).toBeVisible();
    await chip.click();
    await expect(panel.getByText(/^Last reply:/)).toContainText("claude-opus-5-5");
    await expect(panel.getByText(/^Last reply:/)).toContainText("Claude Code's effort");
    await expect.poll(() => panelCalls(page, "assistant:saveChat")).not.toEqual([]);
    expect(await panelCalls(page, "apiKeys:save")).toEqual([]);
    expect(await panelCalls(page, "ai:assistant")).toHaveLength(1);
    await page.screenshot({ path: info.outputPath(`composer-default-${theme}.png`) });
  });
}

test("Codex effort stays separate from features and resets through the keyboard", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(NOW);
  const settings = await assistantSettings("codex");
  settings.ai.codexModel = "";
  settings.ai.codexEffort = "low";
  settings.ai.assistantEffort = { codex: "high" };
  await openMain(page, {
    settings: settings as unknown as Record<string, unknown>,
    responses: {
      "ai:availability": { glaze: true, codex: true },
      "ai:codexModels": [
        {
          slug: "gpt-6-astra",
          name: "GPT-6 Astra",
          description: "Offline synthetic model",
          efforts: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
            effort,
            description: effort,
          })),
          defaultEffort: "medium",
          tiers: [],
          contextWindow: null,
        } satisfies CodexModelInfo,
      ],
    },
  });
  const chip = page.getByRole("button", { name: /^Model and effort:/ });
  await expect(chip).toHaveAttribute("title", "GPT-6 Astra High");
  await chip.click();
  const panel = page.getByRole("dialog", { name: "Model and effort" });
  const slider = panel.getByRole("slider", { name: "Effort" });
  await expect(slider).toHaveAttribute("aria-valuetext", "High");
  await slider.press("ArrowRight");
  await expect(panel.getByText(/^Next request:/)).toContainText("GPT-6 Astra Extra High");
  await panel.getByRole("button", { name: "Reset effort to the model default" }).click();
  await expect(slider).toHaveAttribute("aria-valuetext", "Medium");
  await expect(panel.getByText(/^Next request:/)).toContainText("GPT-6 Astra Medium");
  const updates = (await panelCalls(page, "settings:update")) as { args: AppSettings[] }[];
  expect(updates.at(-1)?.args[0].ai.codexEffort).toBe("low");
  expect(updates.at(-1)?.args[0].ai.assistantEffort.codex).toBeUndefined();
  await page.screenshot({ path: info.outputPath("composer-codex-effort.png") });
});

test("mention range includes day seven independently of Calendar settings and slash actions do not send", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(NOW);
  const settings = await assistantSettings("claude");
  settings.ai.claudeModel = "opus";
  const event = {
    id: "boundary",
    title: "Boundary review",
    start: new Date(2026, 9, 27, 11).toISOString(),
    end: new Date(2026, 9, 27, 12).toISOString(),
    allDay: false,
    calendarId: "primary",
    calendarName: "Calendar",
    calendarColor: null,
    attendees: [],
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
  };
  await openMain(page, {
    settings: settings as unknown as Record<string, unknown>,
    responses: {
      "ai:availability": { claude: true },
      "calendar:listRange": { state: "ok", items: [event] },
    },
  });
  const input = page.getByRole("textbox", { name: "Message Claude" });
  await input.fill("@Boundary");
  await expect(page.getByRole("option", { name: /Boundary review/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("composer-mention.png") });
  await page.getByRole("option", { name: /Boundary review/ }).click();
  await expect(page.getByRole("button", { name: "Remove Boundary review" })).toBeVisible();
  expect(await panelCalls(page, "ai:assistant")).toEqual([]);
  expect(await panelCalls(page, "calendar:listRange")).toContainEqual({
    channel: "calendar:listRange",
    args: [{ startDate: "2026-10-20", days: 8 }],
  });
  await input.fill("/focus");
  await input.press("Tab");
  await expect(input).not.toHaveValue("/focus");
  expect(await panelCalls(page, "ai:assistant")).toEqual([]);
});
