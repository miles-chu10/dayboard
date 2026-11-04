import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TABS,
  activeTab,
  cleanSearch,
  closeTab,
  openTab,
  parseTabs,
  selectTab,
  stepTab,
  updateActive,
  type TabsState,
} from "./tabs";

const tab = (id: string, route = "/") => ({ id, route, search: {} });
const ids = (state: TabsState) => state.tabs.map((item) => item.id);

test("a new tab opens right after the active one and becomes active", () => {
  let state: TabsState = { tabs: [tab("a"), tab("b")], active: "a" };
  state = openTab(state, tab("c", "/mail"));
  assert.deepEqual(ids(state), ["a", "c", "b"]);
  assert.equal(state.active, "c");
  assert.equal(activeTab(state).route, "/mail");
});

test("past the cap the oldest tab goes, never the one just opened", () => {
  let state: TabsState = { tabs: [tab("t0")], active: "t0" };
  for (let index = 1; index <= MAX_TABS; index++) state = openTab(state, tab(`t${index}`));
  assert.equal(state.tabs.length, MAX_TABS);
  assert.equal(ids(state)[0], "t1");
  assert.equal(state.active, `t${MAX_TABS}`);
});

test("closing the active tab moves right, then left; the last tab can't close", () => {
  const three: TabsState = {
    tabs: [tab("a"), tab("b"), tab("c")],
    active: "b",
  };
  assert.equal(closeTab(three, "b").active, "c");
  assert.equal(closeTab({ ...three, active: "c" }, "c").active, "b");
  // Closing a background tab keeps the active one.
  assert.deepEqual(closeTab(three, "a"), {
    tabs: [tab("b"), tab("c")],
    active: "b",
  });
  const one: TabsState = { tabs: [tab("a")], active: "a" };
  assert.equal(closeTab(one, "a"), one);
  assert.equal(closeTab(three, "missing"), three);
});

test("tabs can be selected and stepped through, wrapping at the ends", () => {
  const state: TabsState = {
    tabs: [tab("a"), tab("b"), tab("c")],
    active: "a",
  };
  assert.equal(selectTab(state, "c").active, "c");
  assert.equal(selectTab(state, "nope"), state);
  assert.equal(stepTab(state, 1).active, "b");
  assert.equal(stepTab(state, -1).active, "c");
  assert.equal(stepTab({ ...state, active: "c" }, 1).active, "a");
});

test("navigating records the view in the active tab only, without one-shot hand-offs", () => {
  const state: TabsState = { tabs: [tab("a"), tab("b")], active: "b" };
  const next = updateActive(state, "/mail", cleanSearch({ item: "m1", prompt: "hi", n: 3 }));
  assert.deepEqual(next.tabs, [tab("a"), { id: "b", route: "/mail", search: { item: "m1" } }]);
  assert.equal(updateActive(next, "/mail", { item: "m1" }), next);
});

test("saved tabs load when valid and fall back to one tab otherwise", () => {
  const isRoute = (route: string) => ["/", "/mail", "/notes"].includes(route);
  const fallback = tab("home");
  assert.deepEqual(parseTabs(null, isRoute, fallback), {
    tabs: [fallback],
    active: "home",
  });
  assert.deepEqual(
    parseTabs(
      {
        tabs: [
          { id: "x", route: "/gone", search: {} },
          { id: "y", route: "/notes", search: { note: "n1", prompt: "drop" } },
          { id: "z", route: "/mail" },
        ],
        active: "x",
      },
      isRoute,
      fallback,
    ),
    {
      tabs: [
        { id: "y", route: "/notes", search: { note: "n1" } },
        { id: "z", route: "/mail", search: {} },
      ],
      active: "y",
    },
  );
});
