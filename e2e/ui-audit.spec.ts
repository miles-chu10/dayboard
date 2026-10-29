import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { launchDemo } from "./fixtures";
import { auditLayout } from "./layout-audit";

// Long titles, list names and pasted URLs must truncate or wrap inside their row: never run under
// a neighbour, out of a panel, or squeeze the title away. `stress` lengthens the demo's item text
// in place, the way a pasted URL would, before each layout check.

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

const ROUTES = ["Agenda", "Calendar", "Inbox", "Tasks", "Reminders", "Assistant", "Weekly Review"];

async function navigate(page: Page, route: string) {
  const button = page
    .getByRole("button")
    .filter({ has: page.getByText(route, { exact: true }) })
    .first();
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  // The route has laid out once its title has a box; a slow runner can audit a 0px-wide first frame.
  await expect(page.locator("[data-page-header] h1")).toBeVisible();
}

async function resize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes("main-window.html"),
      );
      if (!window) throw new Error("Missing main window");
      window.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

async function openSettings(app: ElectronApplication, page: Page) {
  await page.evaluate(() => (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"));
  await expect
    .poll(() => app.windows().find((window) => /settings-window/.test(window.url())))
    .not.toBeUndefined();
  const settings = app.windows().find((window) => /settings-window/.test(window.url()))!;
  await settings.waitForLoadState("domcontentloaded");
  await settings.emulateMedia({ colorScheme: null });
  return settings;
}

async function choose(settings: Page, tab: string, radio: string) {
  await settings.getByRole("tab", { name: tab, exact: true }).click();
  await settings.getByRole("radio", { name: radio, exact: true }).click();
  await expect(settings.getByRole("radio", { name: radio, exact: true })).toBeChecked();
}

/** Remounts `route` so text lengthened by an earlier check is gone. */
async function fresh(page: Page, route: string) {
  await navigate(page, route === "Tasks" ? "Reminders" : "Tasks");
  await navigate(page, route);
}

async function closeDetails(page: Page) {
  await page.keyboard.press("Escape");
  const close = page.getByRole("button", { name: /^(Close details|Done)$/ });
  if (await close.count()) await close.first().click();
}

test("long item text stays inside its row on every route, narrow and wide", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await page.emulateMedia({ colorScheme: null });
    const settings = await openSettings(demo.app, page);
    for (const theme of ["Light", "Dark"]) {
      await choose(settings, "General", theme);
      for (const width of [800, 1440]) {
        await resize(demo.app, width, 820);
        for (const route of ROUTES) {
          await fresh(page, route);
          const overdue = page.getByRole("button", { name: /overdue tasks/ });
          if (route === "Agenda" && (await overdue.getAttribute("aria-expanded")) === "false")
            await overdue.click();
          expect(await auditLayout(page), `${route} at ${width}`).toEqual([]);
          expect(
            await auditLayout(page, { stress: true }),
            `long text: ${route} at ${width}`,
          ).toEqual([]);
          if (route === "Agenda" || route === "Calendar")
            await page.screenshot({
              path: testInfo.outputPath(
                `${route.toLowerCase()}-${width}-${theme.toLowerCase()}.png`,
              ),
            });
        }
      }
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("details keep long text inside the pop-up, inline row and side panel", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    const settings = await openSettings(demo.app, page);
    const opens: [string, string, () => Promise<void>][] = [
      [
        "task with notes",
        "Agenda",
        () =>
          page.getByRole("group", { name: "Finalize launch announcement", exact: true }).click(),
      ],
      [
        "linked reminder",
        "Agenda",
        () => page.getByRole("group", { name: "Call Mom", exact: true }).first().click(),
      ],
      [
        "event",
        "Calendar",
        () =>
          page
            .getByRole("button", { name: /^Design review: onboarding flow, / })
            .first()
            .click(),
      ],
      [
        "email",
        "Inbox",
        () => page.getByRole("button", { name: "Open email from Priya Shah", exact: true }).click(),
      ],
    ];
    for (const [mode, label] of [
      ["dialog", "Pop-up"],
      ["inline", "Inline"],
      ["sidebar", "Side panel"],
    ]) {
      await choose(settings, "General", label);
      for (const width of [800, 1440]) {
        await resize(demo.app, width, 820);
        for (const [item, route, open] of opens) {
          await fresh(page, route);
          await open();
          await expect(
            page.locator('[role="dialog"], section[aria-label$=" details"]').first(),
          ).toBeVisible();
          expect(
            await auditLayout(page, { stress: true }),
            `${item} in ${mode} at ${width}`,
          ).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath(`${mode}-${width}-${item.replaceAll(" ", "-")}.png`),
          });
          await closeDetails(page);
        }
      }
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Settings and composer menus have no overlapping or covered controls", async ({
  playwright: _playwright,
}) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    const settings = await openSettings(demo.app, page);
    for (const tab of ["General", "Sources", "AI", "MCP Servers", "License", "Updates"]) {
      const trigger = settings.getByRole("tab", { name: tab, exact: true });
      if (!(await trigger.count())) continue;
      await trigger.click();
      expect(await auditLayout(settings), `Settings ${tab}`).toEqual([]);
    }

    await navigate(page, "Assistant");
    await page.getByRole("button", { name: /^Model and effort:/ }).click();
    await expect(page.getByRole("dialog", { name: "Model and effort" })).toBeVisible();
    expect(await auditLayout(page, { root: '[role="dialog"]' }), "effort panel").toEqual([]);
    await page.keyboard.press("Escape");
    const input = page.getByRole("textbox", { name: /^Message / });
    await input.fill("/");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
    const menu = "[data-radix-popper-content-wrapper]:has([role=listbox])";
    expect(await auditLayout(page, { root: menu }), "slash menu").toEqual([]);
    await input.fill("@");
    await expect(page.getByRole("listbox")).toBeVisible();
    expect(await auditLayout(page, { root: menu, stress: true }), "mention menu").toEqual([]);
    await input.fill("");

    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Quick Capture and the menu bar panel fit long item text", async ({
  playwright: _playwright,
}) => {
  const demo = await launchDemo();
  try {
    // The main window's first show takes focus, which would hide a panel opened earlier.
    await expect(demo.page.getByRole("button", { name: "Agenda" }).first()).toBeVisible();
    for (const [id, hash, ready] of [
      ["quick-capture", "#capture", "textbox"],
      ["menubar-agenda", "#menubar", "heading"],
    ] as const) {
      const opened = demo.app.waitForEvent("window", (panel) => panel.url().endsWith(hash));
      await demo.app.evaluate(
        ({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.click(),
        id,
      );
      const panel = await opened;
      await expect(panel.getByRole(ready).first()).toBeVisible();
      expect(await auditLayout(panel, { stress: true }), hash).toEqual([]);
      await panel.keyboard.press("Escape");
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("a link that can't open says why instead of doing nothing", async ({
  playwright: _playwright,
}) => {
  const demo = await launchDemo();
  try {
    // Demo mode never opens the browser, so Join is refused. The details' Join button shows at
    // any time of day, unlike the sidebar's and the event row's, which hide once the meeting ends.
    await navigate(demo.page, "Calendar");
    await demo.page
      .locator('[role="gridcell"][aria-selected="true"]')
      .getByRole("button", { name: /^Team standup, / })
      .click();
    await demo.page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(demo.page.getByText("Couldn’t open the link")).toBeVisible();
    await expect(demo.page.getByText("Changes are turned off in demo mode.")).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Meeting Notes import, candidate picker and follow-ups fit long Granola text", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    // Stands in for a connected Granola server; real provider acceptance happens on the Mac.
    const long =
      "Hiring panel debrief https://notes.granola.ai/d/b6b0c3d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9";
    await demo.app.evaluate(({ ipcMain }, long) => {
      let record: unknown = null;
      for (const channel of [
        "meetings:notesStatus",
        "meetings:getNotes",
        "meetings:findNotes",
        "meetings:importNotes",
      ])
        ipcMain.removeHandler(channel);
      ipcMain.handle("meetings:notesStatus", () => ({
        provider: { id: "granola", name: "Granola" },
        enabled: true,
      }));
      ipcMain.handle(
        "meetings:getNotes",
        (_event, input: { events: { calendarId: string; eventId: string }[] }) =>
          record
            ? Object.fromEntries(
                input.events.map((event) => [`${event.calendarId}/${event.eventId}`, record]),
              )
            : {},
      );
      ipcMain.handle("meetings:findNotes", () => ({
        selection: "selection-1",
        match: null,
        candidates: [
          { id: "g1", title: long, meetingAt: new Date().toISOString() },
          { id: "g2", title: "Hiring panel", meetingAt: null },
        ],
      }));
      ipcMain.handle("meetings:importNotes", () => {
        record = {
          providerMeetingId: "g1",
          providerUrl: "https://notes.granola.ai/d/g1",
          title: long,
          importedAt: new Date().toISOString(),
          text: `## Decisions\n- Hire for the role ${long}\n## Action items\n- Move ${long} to the shared folder\n- Send the offer to the candidate by Friday`,
        };
        return record;
      });
    }, long);
    const current = await page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke<Record<string, unknown>>("settings:get"),
    );
    const system = current.system as { meetings: Record<string, unknown> };
    await page.evaluate(
      (next) => (globalThis as AppGlobal).dayboard.ipc.invoke("settings:update", next),
      { ...current, system: { ...system, meetings: { ...system.meetings, notesImport: true } } },
    );

    await navigate(page, "Calendar");
    await page
      .getByRole("button", { name: /^Hiring panel, / })
      .first()
      .click();
    const notes = page.getByRole("region", { name: "Meeting notes" });
    await notes.getByRole("button", { name: "Get Notes from Granola" }).click();
    await expect(notes).toContainText("Which Granola notes are from this meeting?");
    expect(await auditLayout(page), "candidate picker").toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("meeting-notes-candidates.png") });

    await notes.getByRole("button", { name: /Hiring panel debrief/ }).click();
    await expect(notes).toContainText("Notes from Granola");
    await expect(notes).toContainText("Follow-ups");
    expect(await auditLayout(page), "imported notes").toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("meeting-notes-imported.png") });

    await notes.getByRole("button", { name: "Open in Granola" }).click();
    await expect(page.getByText("Couldn’t open the link")).toBeVisible();
    await expect(notes.getByText(/^Move Hiring panel debrief/)).toBeVisible();
    await notes
      .getByRole("button", { name: /^Add as (Task|Reminder)$/ })
      .first()
      .click();
    await expect(notes.getByText(/turned off in demo mode/)).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Focus on works from the Calendar's selected day, not only the Agenda", async ({
  playwright: _playwright,
}) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await navigate(page, "Calendar");
    const focus = page.getByRole("button", { name: /^Focus on / }).first();
    const title = (await focus.getAttribute("aria-label"))!.replace(/^Focus on /, "");
    await focus.click();
    const unpin = page.getByRole("button", { name: `Unpin ${title}`, exact: true }).first();
    await expect(unpin).toHaveAttribute("aria-pressed", "true");
    await navigate(page, "Agenda");
    await expect(
      page.getByRole("button", { name: `Unpin ${title}`, exact: true }).first(),
    ).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the audit ignores rows scrolled under their own sticky header, and nothing else", async ({
  playwright: _playwright,
}) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    const header = `<div style="position:sticky;top:0;z-index:1;height:40px;background:#eee"><h2 style="margin:0">Header</h2></div>`;
    const row = (name: string, style = "") =>
      `<button style="display:block;height:30px;width:200px;${style}">${name}</button>`;
    const rows = Array.from({ length: 12 }, (_, i) => row(`Row ${i + 1}`)).join("");
    const pane = (content: string, scroll = 0, style = "height:200px") =>
      `<div data-scroll="${scroll}" style="${style};overflow-y:auto">${content}</div>`;
    async function audit(html: string) {
      await page.evaluate((html) => {
        type Element = {
          scrollTop: number;
          getAttribute(name: string): string | null;
          remove(): void;
        };
        const { document } = globalThis as unknown as {
          document: {
            querySelector(selector: string): Element | null;
            querySelectorAll(selector: string): Iterable<Element>;
            body: { insertAdjacentHTML(position: string, html: string): void };
          };
        };
        document.querySelector("#audit-fixture")?.remove();
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div id="audit-fixture" style="position:fixed;inset:0;z-index:2147483647;background:#fff">${html}</div>`,
        );
        for (const node of document.querySelectorAll("#audit-fixture [data-scroll]"))
          node.scrollTop = Number(node.getAttribute("data-scroll"));
      }, html);
      return auditLayout(page, { root: "#audit-fixture" });
    }
    const covered = (name: string) =>
      expect.stringMatching(new RegExp(`^covered: button "${name}" under`));

    // The Calendar case: the pane scrolled its first rows under its own header.
    expect(await audit(pane(header + rows, 45))).toEqual([]);
    // A header over a row before any scrolling.
    expect(await audit(pane(header + row("Hidden row", "margin-top:-30px") + rows))).toContainEqual(
      covered("Hidden row"),
    );
    // Another pane's header over a scrolled row.
    expect(
      await audit(
        pane(
          header +
            pane(rows, 10, "height:200px;margin-top:-20px") +
            `<div style="height:400px"></div>`,
          0,
          "height:300px",
        ),
      ),
    ).toContainEqual(covered("Row 1"));
    // A header that comes after the row it covers.
    expect(
      await audit(
        pane(
          row("First row") + header.replace("height:40px", "height:40px;margin-top:-20px") + rows,
          5,
        ),
      ),
    ).toContainEqual(covered("First row"));
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
