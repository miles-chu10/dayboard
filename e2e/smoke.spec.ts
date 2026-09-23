import { expect, test } from "@playwright/test";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { BridgeChannel } from "../shared/bridge-protocol";
import { launchDemo } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

test("standalone demo boots securely and renders every primary route", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    await expect(demo.page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    expect(await demo.app.evaluate(({ app }) => app.getPath("userData"))).toBe(demo.profile);
    expect(
      await demo.app.evaluate(({ safeStorage }) => {
        if (!safeStorage.isEncryptionAvailable()) return false;
        const value = "DayBoard disposable encryption fixture";
        return safeStorage.decryptString(safeStorage.encryptString(value)) === value;
      }),
    ).toBe(true);
    expect(
      await demo.page.evaluate(() => {
        const scope = globalThis as unknown as Record<string, unknown>;
        return {
          bridge: !!scope.dayboard,
          require: typeof scope.require,
          process: typeof scope.process,
        };
      }),
    ).toEqual({ bridge: true, require: "undefined", process: "undefined" });
    expect(
      await demo.page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("app:isDemo")),
    ).toBe(true);
    await expect(demo.page.locator("[data-toolbar]").first()).toHaveCSS("app-region", "drag");
    for (const button of await demo.page
      .getByRole("button", { name: "New task, reminder, or event" })
      .all()) {
      await expect(button).toHaveCSS("app-region", "no-drag");
    }

    for (const route of [
      "Agenda",
      "Calendar",
      "Inbox",
      "Tasks",
      "Reminders",
      "Assistant",
      "Weekly Review",
    ]) {
      const button = demo.page
        .getByRole("button")
        .filter({ has: demo.page.getByText(route, { exact: true }) })
        .first();
      await button.click();
      await expect(button).toHaveAttribute("aria-current", "page");
      await expect(demo.page.locator("body")).not.toContainText("Something went wrong");
      await demo.page.screenshot({
        path: testInfo.outputPath(`${route.toLowerCase().replaceAll(" ", "-")}.png`),
      });
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Settings opens separately, saves preferences and survives a full relaunch", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  let relaunch: Awaited<ReturnType<typeof launchDemo>> | undefined;
  try {
    await demo.page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"),
    );
    const settings = await expect
      .poll(async () => demo.app.windows().find((page) => /settings-window/.test(page.url())))
      .not.toBeUndefined()
      .then(() => demo.app.windows().find((page) => /settings-window/.test(page.url()))!);
    await settings.waitForLoadState("domcontentloaded");
    for (const tab of ["General", "Sources", "AI", "MCP Servers", "License", "Updates"]) {
      await settings.getByRole("tab", { name: tab, exact: true }).click();
      await expect(settings.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    await settings.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(settings.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await settings.getByRole("radio", { name: "Compact", exact: true }).click();
    await settings.getByRole("textbox", { name: "Your name" }).fill("Demo Tester");
    await settings.getByRole("textbox", { name: "Your name" }).press("Tab");
    await expect
      .poll(() =>
        settings.evaluate(async () => {
          const settings = await (globalThis as AppGlobal).dayboard.ipc.invoke<{
            general: { userName: string };
          }>("settings:get");
          return settings.general.userName;
        }),
      )
      .toBe("Demo Tester");
    await settings.screenshot({ path: testInfo.outputPath("settings.png") });
    await demo.close(false);
    relaunch = await launchDemo(demo.profile);
    expect(
      await relaunch.page.evaluate(() => (globalThis as AppGlobal).dayboard.nativeTheme.getInfo()),
    ).toMatchObject({ themeSource: "dark" });
    await expect
      .poll(() =>
        relaunch!.page.evaluate(async () => {
          const settings = await (globalThis as AppGlobal).dayboard.ipc.invoke<{
            general: { userName: string };
          }>("settings:get");
          return settings.general.userName;
        }),
      )
      .toBe("Demo Tester");
    expect([...demo.errors, ...relaunch.errors]).toEqual([]);
  } finally {
    if (relaunch) await relaunch.close();
    else if (demo.app.process().exitCode === null) await demo.close();
  }
});

test("native update menu opens Settings and preview update actions stay unavailable", async () => {
  const demo = await launchDemo();
  try {
    await expect(demo.page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    await demo.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("check-updates");
      if (!item) throw new Error("Missing native update menu");
      item.click();
    });
    await expect
      .poll(() => demo.app.windows().find((page) => /settings-window/.test(page.url())))
      .toBeTruthy();
    const settings = demo.app.windows().find((page) => /settings-window/.test(page.url()))!;
    await expect(settings.getByRole("tab", { name: "Updates", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(settings.getByRole("status")).toContainText(
      "Updates are available only in official DayBoard downloads.",
    );
    await expect(
      settings.getByRole("button", {
        name: /Check for updates|Download update|Install and restart/,
      }),
    ).toHaveCount(0);
    for (const action of ["status", "check", "download", "install"]) {
      expect(
        await settings.evaluate(
          (name) => (globalThis as AppGlobal).dayboard.ipc.invoke(`updates:${name}`),
          action,
        ),
      ).toMatchObject({ phase: "unavailable" });
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("closing the main window and activating the app reopens a usable window", async () => {
  const demo = await launchDemo();
  try {
    await expect(demo.page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    await demo.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await expect.poll(() => demo.app.windows().length).toBe(0);
    await demo.app.evaluate(({ app }) => app.emit("activate", {}, false));
    const reopened = await demo.app.firstWindow();
    await expect(reopened.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
  } finally {
    await demo.close();
  }
});

test("update progress freezes both windows and an installation failure restores editing", async () => {
  const demo = await launchDemo();
  try {
    await demo.page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"),
    );
    await expect.poll(() => demo.app.windows().length).toBe(2);
    const settings = demo.app.windows().find((page) => /settings-window/.test(page.url()))!;
    await expect(settings.getByRole("textbox", { name: "Your name" })).toBeVisible();
    for (const phase of ["preparing", "installing", "downloaded"]) {
      await demo.app.evaluate(
        ({ BrowserWindow }, { channel, phase }) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(channel, {
              channel: "updates:changed",
              params: {
                phase,
                message: "Disposable update UI fixture",
                currentVersion: "1.3.0-beta.1",
                availableVersion: "1.3.0-beta.2",
                progressPercent: null,
                error: phase === "downloaded" ? "Fixture installation failed" : null,
              },
            });
          }
        },
        { channel: BridgeChannel.notification, phase },
      );
      for (const page of [demo.page, settings]) {
        if (phase === "downloaded") {
          await expect(page.getByRole("dialog")).toHaveCount(0);
        } else {
          await expect(
            page.getByRole("dialog", {
              name: phase === "preparing" ? "Preparing update" : "Installing update",
            }),
          ).toBeVisible();
          await expect(page.locator("#root > div[inert]")).toHaveCount(1);
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toBeVisible();
        }
      }
    }
    await settings.getByRole("textbox", { name: "Your name" }).fill("Update recovery fixture");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
