// Main process entry point - Node.js backend for Glaze app
//
// The glaze CLI runtime automatically handles all framework wiring (IPC server,
// native bridge, lifecycle, signal handlers) before this file runs.
// This entry point uses only APIs.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  logger,
  initDevToolsButtonState,
  ipcMain,
} from "@glaze/core/backend";

import { registerHandlers } from "./handlers/index.js";
import { createMainWindow, getMainWindow } from "./windows/main-window.js";
import { openSettingsWindow } from "./windows/settings-window.js";
import { startSystemPanels, stopSystemPanels } from "./system-panels/index.js";
import { isPanelWindow, showPanel } from "./system-panels/panel-window.js";
import { startMcpHttpServer } from "./services/mcp-http-server.js";
import { drainAgendaStore } from "./services/agenda-store.js";
import { drainProductivityWrites } from "./handlers/productivity.js";
import { createSaveQuitGuard } from "./services/quit-guard.js";
import { drainPendingWrites } from "./services/pending-writes.js";
import { drainSettingsStores } from "./services/settings-store.js";
import { clearAttachmentPicks } from "./services/ai/attachments.js";
import { clearReminderIdentities } from "./services/apple-reminders.js";

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── IPC Handlers ──────────────────────────────────────────────────────
// ipcMain is already wired to the IPC server by the runtime bootstrap.
registerHandlers();

// ── Dev-only parity harness ───────────────────────────────────────────
// The parity autotest lives in main/dev/, which is excluded from scaffolded
// apps. The build (build-backend) defines GLAZE_DEV_HARNESS="1" only when that
// directory is present, so esbuild dead-code-eliminates this block — and never
// resolves the missing module — for user apps. A no-op unless a scenario env var
// is set even in the template.
type DevHarness = {
  applyParityScenarioStartup(): void;
  runParityAutotestIfRequested(): Promise<void>;
};
type AppAiDevHarness = {
  runAppAiAutotest(): Promise<void>;
};
let devHarness: DevHarness | null = null;
let appAiDevHarness: AppAiDevHarness | null = null;
if (process.env.GLAZE_DEV_HARNESS === "1") {
  // @ts-ignore dev-only harness; present only in the template, excluded from scaffolded apps
  devHarness = (await import("./dev/parity-autotest.js")) as DevHarness;
  devHarness.applyParityScenarioStartup();
  // @ts-ignore dev-only harness; present only in the template, excluded from scaffolded apps
  appAiDevHarness = (await import("./dev/app-ai-autotest.js")) as AppAiDevHarness;
}

// ── Application menu ──────────────────────────────────────────────────
async function setupApplicationMenu() {
  await initDevToolsButtonState();
  const menu = Menu.buildFromTemplate([
    {
      label: "App",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          icon: "gearshape",
          accelerator: "Command+,",
          click: async () => await openSettingsWindow(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Item",
          accelerator: "Command+N",
          click: () => {
            const mainWindow = getMainWindow();
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (BrowserWindow.getFocusedWindow()?.id !== mainWindow.id) return;
            ipcMain.broadcast("capture:open");
          },
        },
        // No accelerator: a menu key equivalent would fire while Settings records a new global
        // shortcut. Keyboard and VoiceOver reach the click-only menu-bar panel from here.
        { label: "Quick Capture…", click: () => void showPanel("capture") },
        { label: "Menu Bar Agenda", click: () => void showPanel("menubar") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
  logger.info("main", "Application menu configured with Settings");
}

// ── Lifecycle events ──────────────────────────────────────────────────
app.on("window-all-closed", () => {
  // On macOS, apps typically don't quit when all windows are closed
  // Uncomment to quit on all windows closed:
  // app.quit();
});

app.on("activate", () => {
  // Floating panels don't count: a Dock click while one is open still brings the dashboard back.
  const hasVisibleWindows = BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isVisible() && !isPanelWindow(window),
  );
  const mainWindow = getMainWindow();
  logger.info("main", "App activate event received", {
    hasVisibleWindows,
    mainWindowExists: !!mainWindow,
    mainWindowDestroyed: mainWindow?.isDestroyed() ?? true,
  });

  // On macOS, re-create window when dock icon clicked if no windows
  if (!hasVisibleWindows) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.info("main", "Creating main window due to activate event");
      void createMainWindow();
    } else {
      logger.info("main", "Showing existing main window");
      mainWindow.show();
    }
  } else {
    logger.info("main", "Has visible windows, no action needed");
  }
});

// Releases the global shortcut and removes the menu-bar icon after the save guard has let the
// quit through; before-quit and its pending-write drain are unchanged.
app.on("will-quit", stopSystemPanels);

const saveBeforeQuit = createSaveQuitGuard({
  drain: async () => {
    await drainProductivityWrites();
    await drainPendingWrites();
    await drainSettingsStores();
    await drainAgendaStore();
  },
  confirmUnfinished: async () => {
    const result = await dialog.showMessageBox({
      type: "warning",
      title: "Changes are still saving",
      message: "Some changes have not finished saving.",
      detail:
        "Keep DayBoard open to let them finish. Quitting now may leave those changes unfinished.",
      buttons: ["Keep Open", "Quit Without Waiting"],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1;
  },
  resumeQuit: () => {
    clearAttachmentPicks();
    clearReminderIdentities();
    app.quit();
  },
});
app.on("before-quit", (event) => {
  void saveBeforeQuit(event).catch(() => {
    logger.warn("main", "Quit cancelled because pending changes could not be checked.");
  });
});

// ── App ready ─────────────────────────────────────────────────────────
const startTime = Date.now();
logger.info("main", "⏱️ [COLD_START] Waiting for app ready...", {
  timestamp: new Date().toISOString(),
});

app.whenReady().then(async () => {
  const windowCreateStartTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] App ready, creating main window", {
    timestamp: new Date().toISOString(),
    wait_duration_ms: windowCreateStartTime - startTime,
  });

  await devHarness?.runParityAutotestIfRequested();
  await appAiDevHarness?.runAppAiAutotest();

  await setupApplicationMenu();

  // Local MCP endpoint for Claude Code / Codex; port is derived from the project id.
  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(path.join(__dirname, "..", "..", "package.json"), "utf-8"),
    ) as { id?: unknown };
    if (typeof packageJson.id === "string") startMcpHttpServer(packageJson.id);
    else logger.warn("main", "package.json has no id; MCP server not started");
  } catch (error) {
    logger.warn("main", "Could not start MCP server", error);
  }

  startSystemPanels();

  createMainWindow()
    .then(() => {
      const windowCreateEndTime = Date.now();
      logger.info("main", "⏱️ [COLD_START] Main window created successfully", {
        timestamp: new Date().toISOString(),
        duration_ms: windowCreateEndTime - windowCreateStartTime,
      });
    })
    .catch((error) => {
      logger.error("main", "Failed to create main window", error);
    });
});
