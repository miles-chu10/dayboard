import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

// Two displays: the built-in below, an external display above it (as in native acceptance).
const builtIn = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 34, width: 1512, height: 948 },
};
const external = {
  bounds: { x: -226, y: -1080, width: 1920, height: 1080 },
  workArea: { x: -226, y: -1050, width: 1920, height: 1050 },
};
const contains = (rect, x, y) =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

const fixture = {
  windows: [],
  tray: null,
  // getBounds() reports the icon's copy on the built-in menu bar, hidden by a menu-bar manager.
  trayBounds: { x: 360, y: 0, width: 22, height: 33 },
  cursor: { x: 0, y: 0 },
};
globalThis.__trayAnchorFixture = fixture;

const backendStub = `
const fixture = globalThis.__trayAnchorFixture;
const displays = ${JSON.stringify([builtIn, external])};
const contains = ${contains.toString()};
const centre = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const displayAt = (point) => displays.find((d) => contains(d.bounds, point.x, point.y)) ?? displays[0];
export const screen = {
  getDisplayMatching: (rect) => displayAt(centre(rect)),
  getDisplayNearestPoint: (point) => displayAt(point),
  getCursorScreenPoint: () => fixture.cursor,
};
export const nativeTheme = { on() {}, removeListener() {}, prefersReducedTransparency: false, shouldUseHighContrastColors: false };
let nextId = 1;
export class BrowserWindow {
  static fromWebContents() { return null; }
  static fromId() { return null; }
  constructor(options) {
    this.id = nextId++;
    this.options = options;
    this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
    this.visible = false;
    fixture.windows.push(this);
  }
  setAlwaysOnTop() {}
  setVibrancy() {}
  on() {}
  once() {}
  async loadURL() {}
  isDestroyed() { return false; }
  isVisible() { return this.visible; }
  isFocused() { return this.visible; }
  getSize() { return [this.bounds.width, this.bounds.height]; }
  getBounds() { return { ...this.bounds }; }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  show() { this.visible = true; }
  focus() {}
  hide() { this.visible = false; }
}
export class Tray {
  constructor() { this.handlers = {}; fixture.tray = this; }
  setToolTip() {}
  on(name, handler) { this.handlers[name] = handler; }
  getBounds() { return fixture.trayBounds; }
  isDestroyed() { return false; }
  destroy() {}
  popUpContextMenu() {}
}
export const Menu = { buildFromTemplate: (template) => template };
export const logger = { error() {}, warn() {}, info() {} };
export const app = { quit() {} };
export const globalShortcut = { unregisterAll() {} };
`;

const root = fileURLToPath(new URL("..", import.meta.url));

// Modules startSystemPanels() pulls in that these tests don't exercise.
const STUBS = {
  "../ipc.js": `export const ipcMain = { handle() {}, broadcast() {} };`,
  "../services/settings-store.js": `export const getSettings = async () => ({
  system: { menuBar: { enabled: true }, quickCapture: { enabled: false, hotkey: "" } },
});
export const onSettingsChanged = () => {};`,
  "../windows/main-window.js": `export const focusMainWindow = async () => {};
export const isMainRoute = () => true;
export const takePendingNavigation = () => null;`,
  "../windows/settings-window.js": `export const openSettingsWindow = async () => {};`,
  "../windows/window-paths.js": `export const getPreloadPath = () => "/tmp/preload.js";
export const getWindowUrl = async (name) => "file:///build/" + name;`,
  "./hotkey.js": `export const createHotkeyManager = () => ({ apply: async () => ({}), suspend: async () => ({}), status: () => ({}) });`,
  "./symbolic-hotkeys.js": `export const readSymbolicHotkeys = async () => null;`,
  "./capture-handlers.js": `export const registerCaptureHandlers = () => {};`,
  "./notification-status.js": `export const notificationStatus = () => ({});`,
  "./meeting-notifications.js": `export const startMeetingNotifications = () => {};`,
};

async function bundle(contents) {
  const result = await build({
    stdin: { contents, resolveDir: root, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "tray-anchor-fixture",
        setup(api) {
          api.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({
            path: "backend",
            namespace: "fixture",
          }));
          api.onResolve({ filter: /.*/ }, (args) =>
            args.path in STUBS ? { path: args.path, namespace: "stub" } : undefined,
          );
          api.onLoad({ filter: /^backend$/, namespace: "fixture" }, () => ({
            contents: backendStub,
            loader: "js",
          }));
          api.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: STUBS[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { startTray, showPanel } = await bundle(`export * from "./main/system-panels/tray.ts";
export { showPanel, togglePanel } from "./main/system-panels/panel-window.ts";`);

const clickedIcon = { x: 925, y: -1080, width: 22, height: 30 };

test("a tray click hands the clicked icon's bounds to the Agenda toggle", () => {
  const anchors = [];
  startTray({
    toggleAgenda: (anchor) => anchors.push(anchor),
    openQuickCapture() {},
    openDayBoard() {},
    openSettings() {},
    quit() {},
  });
  fixture.tray.handlers.click({ type: "click" }, clickedIcon, { x: 10, y: 10 });
  assert.deepEqual(anchors, [clickedIcon]);
});

test("the menu-bar panel opens under the clicked icon, not getBounds()'s copy on another display", async () => {
  fixture.cursor = { x: 936, y: -1070 };
  await showPanel("menubar", clickedIcon);
  const panel = fixture.windows.find((window) => window.options.width === 360);
  assert.ok(panel, "menu-bar panel created");
  const { x, y, width } = panel.getBounds();
  assert.equal(x + width / 2, clickedIcon.x + clickedIcon.width / 2);
  assert.equal(y, external.workArea.y + 6);
  assert.ok(contains(external.bounds, x, y), "on the display that was clicked");
});

test("without a click (File menu), the panel still falls back to the icon's reported bounds", async () => {
  await showPanel("menubar");
  const panel = fixture.windows.find((window) => window.options.width === 360);
  const { x, y, width } = panel.getBounds();
  assert.equal(x + width / 2, fixture.trayBounds.x + fixture.trayBounds.width / 2);
  assert.equal(y, builtIn.workArea.y + 6);
});

test("startSystemPanels forwards a tray click's bounds, so the panel opens under the clicked icon", async () => {
  const { startSystemPanels } = await bundle(
    `export { startSystemPanels } from "./main/system-panels/index.ts";`,
  );
  const created = fixture.windows.length;
  startSystemPanels();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.tray.handlers.click({ type: "click" }, clickedIcon, { x: 10, y: 10 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const panel = fixture.windows.slice(created).find((window) => window.options.width === 360);
  assert.ok(panel, "menu-bar panel created");
  const { x, width } = panel.getBounds();
  assert.equal(x + width / 2, clickedIcon.x + clickedIcon.width / 2);
});
