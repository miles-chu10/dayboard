import { expect, test } from "@playwright/test";
import type { AppSettings, CalendarEventItem } from "../main/shared-types";
import {
  defaultSettings,
  emitPanel,
  openMain,
  openPanel,
  panelCalls,
  setPanelResponse,
  settlePanel,
} from "./panel-harness";

const NOW = new Date(2026, 9, 20, 9, 50);
const event: CalendarEventItem = {
  id: "e1",
  calendarId: "primary",
  calendarName: "Calendar",
  calendarColor: null,
  title: "Synthetic standup",
  start: new Date(2026, 9, 20, 9, 30).toISOString(),
  end: new Date(2026, 9, 20, 9, 45).toISOString(),
  allDay: false,
  attendees: ["synthetic-teammate@example.test"],
  location: null,
  description: null,
  htmlLink: null,
  meetLink: null,
};

const notes = (text: string) => ({
  "primary/e1": {
    providerMeetingId: "synthetic-meeting",
    providerUrl: null,
    title: "Synthetic notes",
    importedAt: new Date(2026, 9, 20, 9, 46).toISOString(),
    text,
  },
});

async function meetingSettings(notesImport: boolean) {
  const settings = (await defaultSettings()) as unknown as AppSettings;
  settings.general.launchView = "today";
  settings.general.refreshMinutes = 0;
  settings.system.meetings.upNext = false;
  settings.system.meetings.notesImport = notesImport;
  return settings as unknown as Record<string, unknown>;
}

for (const surface of ["agenda", "menubar"] as const) {
  for (const notesImport of [true, false]) {
    test(`${surface} notes ${notesImport ? "remain visible" : "are hidden"} with Up Next off`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(NOW);
      const options = {
        settings: await meetingSettings(notesImport),
        responses: {
          "calendar:listRange": { state: "ok", items: [event] },
          "meetings:getNotes": notes("Complete synthetic notes"),
          "meetings:notesStatus": { provider: null },
        },
      };
      if (surface === "agenda") await openMain(page, options);
      else await openPanel(page, "menubar", options);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("region", { name: "Up next meeting" })).toHaveCount(0);
      const ended = page.getByRole("region", { name: "Meeting that just ended" });
      if (notesImport) {
        await expect(ended).toBeVisible();
        await expect(ended.getByText("Complete synthetic notes", { exact: true })).toBeVisible();
      } else await expect(ended).toHaveCount(0);
    });
  }
}

test("manual capture waits for accounts and selects a usable destination", async ({ page }) => {
  const settings = (await defaultSettings()) as unknown as AppSettings;
  settings.ai.features.capture = false;
  await openPanel(page, "capture", {
    settings: settings as unknown as Record<string, unknown>,
    defer: ["accounts:getStatus"],
  });
  await expect(page.getByRole("textbox", { name: "Quick Capture" })).toBeDisabled();
  await expect.poll(() => panelCalls(page, "accounts:getStatus")).toHaveLength(1);
  await settlePanel(page, "accounts:getStatus", {
    google: { connected: true },
    reminders: "denied",
  });
  await expect(page.getByRole("button", { name: "Add task", exact: true })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Task", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Reminder", exact: true })).toBeDisabled();
});

test("a notes notification refreshes Agenda and Menubar together", async ({ page, context }) => {
  const menubar = await context.newPage();
  const options = {
    settings: await meetingSettings(true),
    responses: {
      "calendar:listRange": { state: "ok", items: [event] },
      "meetings:getNotes": notes("Previous synthetic notes"),
      "meetings:notesStatus": { provider: null },
    },
  };
  for (const window of [page, menubar]) await window.clock.setFixedTime(NOW);
  await openMain(page, options);
  await openPanel(menubar, "menubar", options);
  for (const window of [page, menubar]) {
    await expect(window.getByText("Previous synthetic notes", { exact: true })).toBeVisible();
    await setPanelResponse(window, "meetings:getNotes", notes("Fresh complete synthetic notes"));
    await emitPanel(window, "meetings:notesChanged", { calendarId: "primary", eventId: "e1" });
  }
  for (const window of [page, menubar]) {
    await expect(window.getByText("Fresh complete synthetic notes", { exact: true })).toBeVisible();
    await expect(window.getByText("Previous synthetic notes", { exact: true })).toHaveCount(0);
  }
});
