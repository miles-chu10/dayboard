// The menu-bar icon. Left click toggles the mini Agenda panel; right click shows a short menu.

import { Menu, Tray, type Rectangle } from "@glaze/core/backend";

import { setTrayBoundsProvider } from "./panel-window.js";

export interface TrayActions {
  /** `anchor` is the clicked icon: on several displays `getBounds()` can report another copy. */
  toggleAgenda(anchor: Rectangle): void;
  openQuickCapture(): void;
  openDayBoard(): void;
  openSettings(): void;
  quit(): void;
}

// Generated once for DayBoard; keep it unchanged so macOS remembers the icon's menu-bar position.
const TRAY_GUID = "3f6d2a1e-8c4b-4e7a-9b15-6a0c2d9e7f41";

let tray: Tray | null = null;

export function startTray(actions: TrayActions): void {
  if (tray) return;
  // An SF Symbol renders as a template image, so macOS tints it for light and dark menu bars.
  const created = new Tray("calendar.day.timeline.left", TRAY_GUID);
  tray = created;
  created.setToolTip("DayBoard");
  const menu = Menu.buildFromTemplate([
    { label: "Open DayBoard", click: actions.openDayBoard },
    { label: "Quick Capture…", click: actions.openQuickCapture },
    { type: "separator" },
    { label: "Settings…", click: actions.openSettings },
    { label: "Quit DayBoard", click: actions.quit },
  ]);
  // No setContextMenu: left click opens the custom panel, so the menu is shown on right click only.
  created.on("click", (_event, bounds) => actions.toggleAgenda(bounds));
  created.on("right-click", () => created.popUpContextMenu(menu));
  setTrayBoundsProvider(async () => (created.isDestroyed() ? null : await created.getBounds()));
}

export function stopTray(): void {
  setTrayBoundsProvider(async () => null);
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
