import { expect, test } from "@playwright/test";
import type { AppSettings } from "../main/shared-types";
import { defaultSettings, emitPanel, openPanel, panelCalls, settlePanel } from "./panel-harness";

const oldRecord = {
  id: "old-account",
  text: "Private synthetic account A record",
  state: "failed",
  draft: null,
  partial: { title: "Private synthetic account A record" },
  error: "Private synthetic failure",
  canUndo: false,
  createdAt: "2026-10-20T00:00:00Z",
};

async function captureSettings() {
  const settings = (await defaultSettings()) as unknown as AppSettings;
  settings.ai.enabled = true;
  settings.ai.features.capture = true;
  return settings as unknown as Record<string, unknown>;
}

test("account changes clear capture failures and recovered drafts", async ({ page }) => {
  await openPanel(page, "capture", { settings: await captureSettings() });
  const input = page.getByRole("textbox", { name: "Quick Capture" });
  await input.fill("Private synthetic draft");
  await emitPanel(page, "capture:changed", { records: [oldRecord] });
  await expect(page.getByText(/Private synthetic account A record/)).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    oldRecord.text,
  );
  await emitPanel(page, "accounts:changed");
  await expect(page.getByText(/Private synthetic account A record/)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("");
});

for (const surface of ["capture", "menubar"] as const) {
  test(`${surface} discards a recent read that completes after an account change`, async ({
    page,
  }) => {
    await openPanel(page, surface, {
      settings: await captureSettings(),
      defer: ["capture:recent"],
    });
    await expect.poll(() => panelCalls(page, "capture:recent")).toHaveLength(1);
    await emitPanel(page, "accounts:changed");
    await settlePanel(page, "capture:recent", [oldRecord]);
    await expect(page.getByText(/Private synthetic account A record/)).toHaveCount(0);
  });

  test(`${surface} discards a submit rejection that completes after an account change`, async ({
    page,
  }) => {
    await openPanel(page, surface, {
      settings: await captureSettings(),
      defer: ["capture:submit"],
    });
    const input = page.getByRole("textbox", {
      name: surface === "capture" ? "Quick Capture" : "Add or ask",
    });
    await input.fill("Private synthetic account A submission");
    await input.press("Enter");
    await expect.poll(() => panelCalls(page, "capture:submit")).toHaveLength(1);
    await emitPanel(page, "accounts:changed");
    await settlePanel(page, "capture:submit", null, "Private synthetic old-account error");
    await expect(input).toHaveValue("");
    await expect(page.getByText(/Private synthetic old-account error/)).toHaveCount(0);
    await expect(page.getByText(/Private synthetic account A submission/)).toHaveCount(0);
    expect(await panelCalls(page, "panel:show")).toEqual([]);
  });
}
