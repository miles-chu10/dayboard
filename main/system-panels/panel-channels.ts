// The only app channels the floating panels may invoke or stream (enforced in platform/ipc.ts).
// Settings writes, account changes, MCP configuration and deletes stay with the main windows.

export const PANEL_CHANNELS: ReadonlySet<string> = new Set([
  // Startup, theme and source reads
  "app:isDemo",
  "settings:get",
  "nativeTheme:getInfo",
  "accounts:getStatus",
  "agenda:getScope",
  "agenda:getState",
  "tasks:list",
  "reminders:list",
  "calendar:list",
  "calendar:listRange",
  "ai:availability",
  "license:status",
  // Quick Capture
  "capture:submit",
  "capture:undo",
  "capture:recent",
  // Meeting prep
  "ai:run",
  "mail:related",
  // Meeting notes and their follow-ups
  "meetings:notesStatus",
  "meetings:findNotes",
  "meetings:importNotes",
  "meetings:getNotes",
  "tasks:create",
  "reminders:create",
  // Panel control
  "panel:hide",
  "panel:show",
  "panel:resize",
  "panel:openMain",
  "window:openSettings",
  "app:openExternal",
]);
