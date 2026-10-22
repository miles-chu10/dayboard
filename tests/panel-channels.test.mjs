import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { PANEL_CHANNELS } = await loadTs("main/system-panels/panel-channels.ts");

test("panel allow-list is exactly the reviewed set", () => {
  assert.deepEqual([...PANEL_CHANNELS].sort(), [
    "accounts:getStatus",
    "agenda:getScope",
    "agenda:getState",
    "ai:availability",
    "ai:run",
    "app:isDemo",
    "app:openExternal",
    "calendar:list",
    "calendar:listRange",
    "capture:recent",
    "capture:submit",
    "capture:undo",
    "mail:related",
    "meetings:findNotes",
    "meetings:getNotes",
    "meetings:importNotes",
    "meetings:notesStatus",
    "panel:hide",
    "panel:openMain",
    "panel:resize",
    "panel:show",
    "reminders:create",
    "reminders:list",
    "settings:get",
    "tasks:create",
    "tasks:list",
    "window:openSettings",
  ]);
});

test("panel allow-list excludes settings, MCP, account and delete channels", () => {
  for (const channel of [
    "settings:update",
    "mcp:save",
    "mcp:test",
    "google:connect",
    "google:disconnect",
    "tasks:delete",
    "calendar:delete",
    "calendar:create",
    "ai:assistant",
    "system:suspendHotkey",
    "meetings:checkProviders",
  ]) {
    assert.equal(PANEL_CHANNELS.has(channel), false, channel);
  }
});
