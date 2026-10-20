// The menu-bar icon. Left click toggles the mini Agenda panel; right click shows a short menu.

import { Menu, Tray, nativeImage, type Rectangle } from "electron";

import icon from "./assets/trayTemplate.png?asset";
import icon2x from "./assets/trayTemplate@2x.png?asset";
import { setTrayBoundsProvider } from "./panel-window.js";

export interface TrayActions {
  /** `anchor` is the clicked icon: on several displays `getBounds()` can report another copy. */
  toggleAgenda(anchor: Rectangle): void;
  openQuickCapture(): void;
  openDayBoard(): void;
  openSettings(): void;
  quit(): void;
}

let tray: Tray | null = null;

function templateImage() {
  const image = nativeImage.createFromPath(icon);
  image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(icon2x).toPNG() });
  image.setTemplateImage(true);
  return image;
}

export function startTray(actions: TrayActions): void {
  if (tray) return;
  const created = new Tray(templateImage());
  tray = created;
  created.setToolTip("DayBoard");
  const menu = Menu.buildFromTemplate([
    { label: "Open DayBoard", click: actions.openDayBoard },
    { label: "Quick Capture…", click: actions.openQuickCapture },
    { type: "separator" },
    { label: "Settings…", click: actions.openSettings },
    { label: "Quit DayBoard", click: actions.quit },
  ]);
  created.on("click", (_event, bounds) => actions.toggleAgenda(bounds));
  created.on("right-click", () => created.popUpContextMenu(menu));
  setTrayBoundsProvider(() => (created.isDestroyed() ? null : created.getBounds()));
}

export function stopTray(): void {
  setTrayBoundsProvider(() => null);
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
