import { app, dialog, logger } from "./platform/index.js";
import { registerHandlers } from "./handlers/index.js";
import {
  acquireSingleInstanceLock,
  createMainWindow,
  getMainWindow,
  setupApplicationMenu,
} from "./window.js";
import { startMcpHttpServer } from "./services/mcp-http-server.js";
import { drainAgendaStore } from "./services/agenda-store.js";
import { drainProductivityWrites } from "./handlers/productivity.js";
import { createSaveQuitGuard } from "./services/quit-guard.js";
import { drainPendingWrites } from "./services/pending-writes.js";
import { drainSettingsStores } from "./services/settings-store.js";
import { clearAttachmentPicks } from "./services/ai/attachments.js";
import { clearReminderIdentities } from "./services/apple-reminders.js";
import { drainNativeThemeWrites, loadNativeTheme } from "./platform/native-theme.js";
import { registerUpdateHandlers } from "./handlers/updates.js";
import { pauseAndDrainAppOperations, resumeAppOperations } from "./services/runtime-activity.js";

// The standalone package has no Glaze project id. Keep the local MCP port stable across builds.
const MCP_PROJECT_ID = "com.mileschu.dayboard";

let updates: ReturnType<typeof registerUpdateHandlers> | undefined;
async function drainAppWrites(): Promise<void> {
  await drainProductivityWrites();
  await drainPendingWrites();
  await drainSettingsStores();
  await drainAgendaStore();
  await drainNativeThemeWrites();
}

const saveBeforeQuit = createSaveQuitGuard({
  drain: async () => {
    await pauseAndDrainAppOperations();
    await drainAppWrites();
  },
  onCancelled: resumeAppOperations,
  isUpdateInstallReady: () => updates?.status().phase === "installing",
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

if (acquireSingleInstanceLock()) {
  app.on("before-quit", (event) => {
    void saveBeforeQuit(event).catch((error) => {
      logger.warn("main", "Quit cancelled because pending changes could not be checked", error);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", (_event, hasVisibleWindows) => {
    if (hasVisibleWindows) return;
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    } else {
      void createMainWindow().catch((error) =>
        logger.error("main", "Failed to reopen main window", error),
      );
    }
  });

  void app
    .whenReady()
    .then(async () => {
      await loadNativeTheme();
      registerHandlers();
      updates = registerUpdateHandlers({
        prepareForInstall: async () => {
          await pauseAndDrainAppOperations();
          try {
            await drainAppWrites();
          } catch (error) {
            resumeAppOperations();
            throw error;
          }
        },
        resumeAfterInstallFailure: resumeAppOperations,
      });
      setupApplicationMenu({ checkForUpdates: () => updates!.check() });
      startMcpHttpServer(MCP_PROJECT_ID);
      await createMainWindow();
    })
    .catch((error) => {
      logger.error("main", "Failed to start DayBoard", error);
      app.quit();
    });
}
