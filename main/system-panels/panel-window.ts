// Floating panel windows for Quick Capture and the menu-bar Agenda. A `panel` window floats over
// full-screen apps on every Space and takes key focus without activating DayBoard, so hiding it
// hands the keyboard back to the previous app.

import { BrowserWindow, logger, nativeTheme, screen } from "@glaze/core/backend";

import { capturePanelBounds, menuBarPanelBounds, type Rect } from "../../shared/panel-placement.js";
import { getPreloadPath, getWindowUrl } from "../windows/window-paths.js";
import {
  PANEL_PAGE,
  registerPanelWindow,
  setPanelWindowLookup,
  unregisterPanelWindow,
} from "./panel-registry.js";

// Lets the IPC guard resolve a sender to its window without importing BrowserWindow itself.
setPanelWindowLookup({
  fromSender: (sender) =>
    BrowserWindow.fromWebContents(sender as Parameters<typeof BrowserWindow.fromWebContents>[0]),
  fromId: (id) => BrowserWindow.fromId(id),
});

export type PanelSurface = "capture" | "menubar";

export function isPanelSurface(value: unknown): value is PanelSurface {
  return value === "capture" || value === "menubar";
}

const WIDTH: Record<PanelSurface, number> = { capture: 560, menubar: 360 };
const INITIAL_HEIGHT: Record<PanelSurface, number> = {
  capture: 76,
  menubar: 520,
};
export const MIN_PANEL_HEIGHT = 48;
export const MAX_PANEL_HEIGHT = 560;

const panels = new Map<PanelSurface, BrowserWindow>();
const shownAt = new WeakMap<BrowserWindow, number>();
const SHOW_GRACE_MS = 300;
const creating = new Map<PanelSurface, Promise<BrowserWindow>>();
let trayBounds: () => Promise<Rect | null> = async () => null;

export function setTrayBoundsProvider(provider: () => Promise<Rect | null>): void {
  trayBounds = provider;
}

function material(): "popover" | null {
  return nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors
    ? null
    : "popover";
}

async function createPanel(surface: PanelSurface): Promise<BrowserWindow> {
  // No windowKey: that turns on frame persistence, and panels are placed by hand on each show.
  const window = new BrowserWindow({
    type: "panel",
    width: WIDTH[surface],
    height: INITIAL_HEIGHT[surface],
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    vibrancy: material(),
    visualEffectState: "active",
    title: surface === "capture" ? "Quick Capture" : "DayBoard",
    webPreferences: { preload: getPreloadPath() },
  });
  registerPanelWindow(window.id);
  window.setAlwaysOnTop(true, "floating");
  // Glaze's runtime treats full-screen visibility as a separate request (its NSPanel code checks
  // isVisibleOnFullScreenRequested), so ask for it. skipTransformProcessType avoids the Dock and
  // windows briefly hiding as the process type changes. Confirm over a full-screen app in Glaze.
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  const updateMaterial = () => {
    if (!window.isDestroyed()) window.setVibrancy(material());
  };
  nativeTheme.on("updated", updateMaterial);
  window.once("closed", () => {
    nativeTheme.removeListener("updated", updateMaterial);
    unregisterPanelWindow(window.id);
    if (panels.get(surface) === window) panels.delete(surface);
  });
  // Hiding a panel lets macOS make another window key asynchronously; when the panel is shown
  // again right away (a rejected capture re-shows it) that late key change arrives as a blur.
  // A blur that soon after showing re-focuses the panel; a later one is a real click-away.
  window.on("blur", () => {
    setTimeout(() => {
      if (window.isDestroyed() || !window.isVisible() || window.isFocused()) return;
      if (Date.now() - (shownAt.get(window) ?? 0) < SHOW_GRACE_MS) window.focus();
      else window.hide();
    }, 0);
  });
  await window.loadURL(`${await getWindowUrl(PANEL_PAGE)}#${surface}`);
  panels.set(surface, window);
  return window;
}

function ensurePanel(surface: PanelSurface): Promise<BrowserWindow> {
  const existing = panels.get(surface);
  if (existing && !existing.isDestroyed()) return Promise.resolve(existing);
  let pending = creating.get(surface);
  if (!pending) {
    pending = createPanel(surface).finally(() => creating.delete(surface));
    creating.set(surface, pending);
  }
  return pending;
}

async function placement(
  surface: PanelSurface,
  window: BrowserWindow,
  anchor: Rect | null,
): Promise<Rect> {
  const [width, height] = window.getSize();
  if (surface === "menubar") {
    const tray = anchor && anchor.width > 0 && anchor.height > 0 ? anchor : await trayBounds();
    const display =
      tray && tray.width > 0
        ? screen.getDisplayMatching(tray)
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return menuBarPanelBounds(tray, display.workArea, { width, height });
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return capturePanelBounds(display.workArea, { width, height });
}

/** `anchor`: the clicked menu-bar icon, when a click opened the panel. */
export async function showPanel(surface: PanelSurface, anchor: Rect | null = null): Promise<void> {
  const window = await ensurePanel(surface);
  window.setBounds(await placement(surface, window, anchor));
  shownAt.set(window, Date.now());
  window.show();
  window.focus();
}

export function hidePanel(surface: PanelSurface): void {
  const window = panels.get(surface);
  if (window && !window.isDestroyed() && window.isVisible()) window.hide();
}

export function isPanelVisible(surface: PanelSurface): boolean {
  const window = panels.get(surface);
  return Boolean(window && !window.isDestroyed() && window.isVisible());
}

export async function togglePanel(
  surface: PanelSurface,
  anchor: Rect | null = null,
): Promise<void> {
  if (isPanelVisible(surface)) hidePanel(surface);
  else
    await showPanel(surface, anchor).catch((error) =>
      logger.error("panels", `Could not open the ${surface} panel`, error),
    );
}

/** Keeps the panel's top edge fixed while its content grows or shrinks. */
export function resizePanel(surface: PanelSurface, height: number): void {
  const window = panels.get(surface);
  if (!window || window.isDestroyed()) return;
  const clamped = Math.round(Math.min(Math.max(height, MIN_PANEL_HEIGHT), MAX_PANEL_HEIGHT));
  const bounds = window.getBounds();
  if (bounds.height !== clamped) window.setBounds({ ...bounds, height: clamped });
}

export function isPanelWindow(window: BrowserWindow): boolean {
  return [...panels.values()].includes(window);
}
