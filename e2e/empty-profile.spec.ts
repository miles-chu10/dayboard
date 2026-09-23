import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { launchEmptyProfile } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

test("empty normal profile is usable without accounts or merchant configuration", async () => {
  const empty = await launchEmptyProfile();
  try {
    await expect(empty.page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    expect(
      await empty.page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("app:isDemo")),
    ).toBe(false);
    expect(
      await empty.page.evaluate(() =>
        (globalThis as AppGlobal).dayboard.ipc.invoke("license:status"),
      ),
    ).toMatchObject({ status: { state: "unconfigured" }, checkoutUrl: "" });
    await empty.page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings", { tab: "license" }),
    );
    await expect
      .poll(() => empty.app.windows().find((page) => /settings-window/.test(page.url())))
      .toBeTruthy();
    const settings = empty.app.windows().find((page) => /settings-window/.test(page.url()))!;
    await expect(settings.getByRole("tab", { name: "License", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(settings.getByText("Preview build", { exact: true })).toBeVisible();
    await expect(settings.getByRole("textbox", { name: "License key" })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: /Buy DayBoard/ })).toHaveCount(0);
    await expect(empty.page.locator("body")).not.toContainText("Alex Rivera");
    expect((await readdir(empty.profile)).some((file) => file.includes("license"))).toBe(false);
    expect(empty.errors).toEqual([]);
  } finally {
    await empty.close();
  }
});
