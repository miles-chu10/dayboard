// Floating NSPanel windows for Quick Capture and the menu-bar Agenda. A `panel` window floats
// over full-screen apps on every Space and takes key focus without activating DayBoard, so
// hiding it hands the keyboard straight back to the previous app (verified on Electron 44).

import { BrowserWindow, nativeTheme, screen, type WebContents } from "electron";

import { capturePanelBounds, menuBarPanelBounds, type Rect } from "../../shared/panel-placement.js";
import { logger } from "../platform/index.js";
import { entryUrl, hardenWindow, secureWebPreferences } from "../window.js";
import { PANEL_CHANNELS } from "./panel-channels.js";

export type PanelSurface = "capture" | "menubar";

export function isPanelSurface(value: unknown): value is PanelSurface {
  return value === "capture" || value === "menubar";
}

const WIDTH: Record<PanelSurface, number> = { capture: 560, menubar: 360 };
const INITIAL_HEIGHT: Record<PanelSurface, number> = { capture: 76, menubar: 520 };
export const MIN_PANEL_HEIGHT = 48;
export const MAX_PANEL_HEIGHT = 560;

const panels = new Map<PanelSurface, BrowserWindow>();
const shownAt = new WeakMap<BrowserWindow, number>();
const SHOW_GRACE_MS = 300;
const creating = new Map<PanelSurface, Promise<BrowserWindow>>();
let trayBounds: () => Rect | null = () => null;

export function setTrayBoundsProvider(provider: () => Rect | null): void {
  trayBounds = provider;
}

function material(): "popover" | undefined {
  return nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors
    ? undefined
    : "popover";
}

async function createPanel(surface: PanelSurface): Promise<BrowserWindow> {
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
    webPreferences: secureWebPreferences(),
  });
  window.setAlwaysOnTop(true, "floating");
  const updateMaterial = () => {
    if (!window.isDestroyed()) window.setVibrancy(material() ?? null);
  };
  nativeTheme.on("updated", updateMaterial);
  window.once("closed", () => {
    nativeTheme.removeListener("updated", updateMaterial);
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
  const url = entryUrl("panel-window.html");
  hardenWindow(window, url, { channels: PANEL_CHANNELS });
  await window.loadURL(`${url}#${surface}`);
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

function placement(surface: PanelSurface, window: BrowserWindow, anchor: Rect | null): Rect {
  const [width, height] = window.getSize();
  if (surface === "menubar") {
    const tray = anchor && anchor.width > 0 && anchor.height > 0 ? anchor : trayBounds();
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
  window.setBounds(placement(surface, window, anchor));
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

export function getPanelContents(surface: PanelSurface): WebContents | null {
  const window = panels.get(surface);
  return window && !window.isDestroyed() ? window.webContents : null;
}

export function isPanelWindow(window: BrowserWindow): boolean {
  return [...panels.values()].includes(window);
}
