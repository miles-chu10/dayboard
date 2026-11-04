import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings } from "@main/shared-types";

import { NAV_ITEMS, navTargets, visibleNav } from "./navigation";

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
    ["home", "agenda", "calendar", "mail", "tasks", "notes", "assistant"],
  );
});

test("with AI off only Home, the Agenda, sources and Notes remain", () => {
  assert.deepEqual(
    visibleNav(settings({ ai: false })).map((item) => item.id),
    ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"],
  );
});

test("before settings load every source shows, AI views don't", () => {
  assert.deepEqual(
    visibleNav(undefined).map((item) => item.id),
    ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"],
  );
});

test("the sidebar follows the saved order and leaves out hidden views; ⌘K keeps them", () => {
  const custom = {
    ...settings({}),
    general: {
      sidebar: {
        order: ["mail", "home", "notes", "agenda", "calendar", "tasks", "reminders"],
        hidden: ["agenda", "reminders"],
        counts: true,
      },
    },
  } as unknown as AppSettings;
  assert.deepEqual(
    visibleNav(custom).map((item) => item.id),
    ["mail", "home", "notes", "calendar", "tasks", "assistant", "review"],
  );
  assert.deepEqual(
    navTargets(custom).map((item) => item.id),
    ["mail", "home", "notes", "agenda", "calendar", "tasks", "reminders", "assistant", "review"],
  );
});
