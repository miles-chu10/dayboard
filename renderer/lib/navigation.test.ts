import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings } from "@main/shared-types";

import { NAV_ITEMS, visibleNav } from "./navigation";

type Source = "tasks" | "reminders" | "mail" | "calendar";

function settings(overrides: {
  sources?: Partial<Record<Source, boolean>>;
  ai?: boolean;
  features?: Partial<Record<string, boolean>>;
}): AppSettings {
  const source = (id: Source) => ({
    enabled: overrides.sources?.[id] ?? true,
    color: "blue",
  });
  return {
    sources: {
      tasks: source("tasks"),
      reminders: source("reminders"),
      mail: source("mail"),
      calendar: source("calendar"),
    },
    ai: {
      enabled: overrides.ai ?? true,
      features: { assistant: true, weeklyReview: true, ...overrides.features },
    },
  } as unknown as AppSettings;
}

test("every view is listed once with a route", () => {
  const routes = NAV_ITEMS.map((item) => item.route);
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(new Set(NAV_ITEMS.map((item) => item.id)).size, NAV_ITEMS.length);
});

test("turned-off sources and AI features leave the list", () => {
  const visible = visibleNav(
    settings({
      sources: { reminders: false },
      features: { weeklyReview: false },
    }),
  );
  assert.deepEqual(
    visible.map((item) => item.id),
    ["agenda", "calendar", "mail", "tasks", "assistant"],
  );
});

test("with AI off only the Agenda and sources remain", () => {
  assert.deepEqual(
    visibleNav(settings({ ai: false })).map((item) => item.id),
    ["agenda", "calendar", "mail", "tasks", "reminders"],
  );
});

test("before settings load every source shows, AI views don't", () => {
  assert.deepEqual(
    visibleNav(undefined).map((item) => item.id),
    ["agenda", "calendar", "mail", "tasks", "reminders"],
  );
});
