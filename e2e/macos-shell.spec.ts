import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestProfile, launchDemo } from "./fixtures";

test("responsive details preserve the mounted editor and keyboard pane preferences", async () => {
  const profile = await createTestProfile();
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ general: { detailView: "sidebar" } }),
  );
  const demo = await launchDemo(profile);
  const size = (width: number) =>
    demo.app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800),
      width,
    );
  try {
    await size(1100);
    await demo.page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button")
      .filter({ has: demo.page.getByText("Tasks", { exact: true }) })
      .click();
    const sidebar = demo.page.getByRole("separator", { name: "Resize sidebar" });
    await sidebar.focus();
    await demo.page.keyboard.press("ArrowRight");
    await expect(sidebar).toHaveAttribute("aria-valuenow", "248");
    await demo.page.keyboard.press("Shift+ArrowLeft");
    await expect(sidebar).toHaveAttribute("aria-valuenow", "216");
    await demo.page.keyboard.press("Home");
    await expect(sidebar).toHaveAttribute("aria-valuenow", "180");
    await expect
      .poll(() =>
        demo.page.evaluate(() =>
          localStorage.getItem("dayboard:split-view:productivity-shell:sidebar"),
        ),
      )
      .toBe("180");
    const row = demo.page
      .locator("[data-detail-anchor]")
      .first()
      .getByRole("button", { name: /^Open / })
      .first();
    await row.click();
    const inspector = demo.page.locator("[data-inspector]");
    await expect(inspector).toHaveAttribute("data-inspector-layout", "side");
    const panel = await inspector
      .getByRole("region")
      .elementHandle()
      .catch(() => null);
    const mounted = panel ?? (await inspector.locator("section").elementHandle());
    const resize = demo.page.getByRole("separator", { name: "Resize details" });
    await resize.focus();
    await demo.page.keyboard.press("ArrowLeft");
    await expect(resize).toHaveAttribute("aria-valuenow", "288");
    await demo.page.keyboard.press("Shift+ArrowRight");
    await expect(resize).toHaveAttribute("aria-valuenow", "256");
    await expect
      .poll(() =>
        demo.page.evaluate(() => localStorage.getItem("dayboard:split-view:tasks:inspector")),
      )
      .toBe("256");
    await inspector.getByRole("button", { name: "Edit", exact: true }).click();
    const title = demo.page.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toBeDisabled();
    const initialTitle = await title.inputValue();
    const draft = await title.elementHandle();
    await size(800);
    await expect(inspector).toHaveAttribute("data-inspector-layout", "inline");
    await expect(title).toHaveValue(initialTitle);
    expect(await draft!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
    await demo.page.keyboard.press("Control+Meta+I");
    await expect(inspector).toBeVisible();
    await size(1280);
    await expect(inspector).toHaveAttribute("data-inspector-layout", "side");
    await expect(title).toHaveValue(initialTitle);
    await demo.page.keyboard.press("Escape");
    await expect(demo.page.getByRole("dialog")).toHaveCount(0);
    await expect(inspector).toBeVisible();
    await inspector.getByRole("region").focus();
    await demo.page.keyboard.press("Control+Meta+I");
    await expect(inspector).toBeHidden();
    const showDetails = demo.page.getByRole("button", { name: "Show details", exact: true });
    await expect(showDetails).toBeFocused();
    await showDetails.click();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("region")).toBeFocused();
    expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
    await inspector.getByRole("region").focus();
    await demo.page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
    await expect(row).toBeFocused();
    await demo.page.keyboard.press("Enter");
    await expect(inspector.getByRole("region")).toBeFocused();
    await demo.page.keyboard.press("Control+Meta+I");
    await expect(showDetails).toBeFocused();
    const nextRow = demo.page
      .locator("[data-detail-anchor]")
      .getByRole("button", { name: /^Open / })
      .nth(1);
    await nextRow.focus();
    await demo.page.keyboard.press("Enter");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("region")).toBeFocused();
    await demo.page.keyboard.press("Escape");
    await expect(nextRow).toBeFocused();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Calendar compact rows retain titles and restore focus after the selected-day list returns", async () => {
  const profile = await createTestProfile();
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ general: { detailView: "sidebar" } }),
  );
  const demo = await launchDemo(profile);
  try {
    await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1100, 800),
    );
    await demo.page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button")
      .filter({ has: demo.page.getByText("Calendar", { exact: true }) })
      .click();
    const selectedDay = demo.page.getByRole("complementary", { name: "Selected day", exact: true });
    await expect(selectedDay).toBeVisible();
    const titles = selectedDay.locator("[data-agenda-title]");
    await expect.poll(() => titles.count()).toBeGreaterThan(2);
    await expect
      .poll(() =>
        titles.evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              node.clientWidth >= 96 &&
              node.scrollWidth <= node.clientWidth &&
              (
                globalThis as unknown as {
                  getComputedStyle(node: unknown): { fontSize: string };
                }
              ).getComputedStyle(node).fontSize === "13px",
          ),
        ),
      )
      .toBe(true);
    const event = selectedDay.getByRole("group", { name: /^Lunch with Sam,/ });
    await event.focus();
    await demo.page.keyboard.press("Enter");
    const eventPanel = demo.page.getByRole("region", {
      name: "Lunch with Sam details",
      exact: true,
    });
    await expect(eventPanel).toBeFocused();
    await demo.page.keyboard.press("Escape");
    await expect(event).toBeFocused();
    const todo = selectedDay.getByRole("group", { name: "Pick up dry cleaning", exact: true });
    await todo.focus();
    await demo.page.keyboard.press("Enter");
    await expect(
      demo.page.getByRole("region", { name: "Pick up dry cleaning details", exact: true }),
    ).toBeFocused();
    await demo.page.keyboard.press("Escape");
    await expect(todo).toBeFocused();
    const chip = demo.page
      .getByRole("grid", { name: "Month", exact: true })
      .locator('[role="gridcell"][aria-selected="false"]')
      .getByRole("button")
      .first();
    await chip.focus();
    await demo.page.keyboard.press("Enter");
    await expect(demo.page.locator("[data-inspector]").getByRole("region")).toBeFocused();
    await demo.page.keyboard.press("Escape");
    await expect(chip).toBeFocused();
    await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(800, 600),
    );
    await expect(demo.page.locator("[data-details-layout]")).toHaveAttribute(
      "data-details-stacked",
      "true",
    );
    await expect(demo.page.getByRole("radio", { name: "Week", exact: true })).toBeInViewport();
    await expect
      .poll(() =>
        demo.page.locator('[role="gridcell"][aria-selected="true"]').evaluate((cell) => {
          const viewport = cell.closest("[data-radix-scroll-area-viewport]")!;
          const bounds = viewport.getBoundingClientRect();
          const day = cell.firstElementChild!.getBoundingClientRect();
          const controls = viewport
            .querySelector("[data-calendar-controls]")!
            .getBoundingClientRect();
          return day.top >= controls.bottom - 1 && day.bottom <= bounds.bottom + 1;
        }),
      )
      .toBe(true);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("native accessibility updates reach the opaque shell without changing system preferences", async () => {
  const demo = await launchDemo();
  try {
    await demo.page.getByRole("button", { name: "Profile menu for Alex Rivera" }).waitFor();
    await demo.app.evaluate(({ nativeTheme }) => {
      for (const name of [
        "prefersReducedTransparency",
        "shouldUseHighContrastColors",
        "shouldDifferentiateWithoutColor",
      ]) {
        Object.defineProperty(nativeTheme, name, { configurable: true, get: () => true });
      }
      nativeTheme.emit("updated");
    });
    for (const state of [
      "reduce-transparency",
      "increase-contrast",
      "differentiate-without-color",
    ]) {
      await expect(demo.page.locator("html")).toHaveClass(new RegExp(state));
    }
    await demo.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(demo.page.locator("html")).toHaveClass(/reduce-motion/);
    await expect(demo.page.locator(".differentiate-status-icon")).toBeVisible();
    const fills = await demo.page
      .locator(".app-sidebar-badge, [data-slot=sidebar-item-accessory]")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            (
              globalThis as unknown as {
                getComputedStyle(node: unknown): { backgroundColor: string };
              }
            ).getComputedStyle(node).backgroundColor,
        ),
      );
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((fill) => !fill.startsWith("rgba") && fill !== "transparent")).toBe(true);
    await demo.app.evaluate(({ nativeTheme }) => {
      for (const name of [
        "prefersReducedTransparency",
        "shouldUseHighContrastColors",
        "shouldDifferentiateWithoutColor",
      ])
        delete (nativeTheme as unknown as Record<string, unknown>)[name];
      nativeTheme.emit("updated");
    });
    await expect(demo.page.locator("html")).not.toHaveClass(/differentiate-without-color/);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
