/**
 * Handler Registration
 *
 * Register all your IPC handlers here
 */

import { appHandlers } from "./app.js";
import { registerAIHandlers } from "./ai.js";
import { registerAssistantHistoryHandlers } from "./assistant-history.js";
import { registerItemEditingHandlers } from "./item-editing.js";
import { registerProductivityHandlers } from "./productivity.js";
import { registerProfileHandlers } from "./profile.js";
import { registerStartupHandlers } from "./startup.js";
import { registerLicenseHandlers } from "./license.js";
import { assertLicenseAccess } from "../services/license/index.js";
import { setLicenseAccessGuard } from "../platform/ipc.js";
import { isSettingsTab } from "../../shared/settings-navigation.js";
import { getSettingsWindow, openSettingsWindow } from "../window.js";

import { app, ipcMain, logger } from "../platform/index.js";

export function registerHandlers(): void {
  setLicenseAccessGuard(assertLicenseAccess);
  logger.info("handlers", "Registering IPC handlers...");

  // Register app handlers using ipcMain API
  ipcMain.handle("app:getInfo", async (_event) => {
    return await appHandlers.getInfo();
  });

  // Return the installed app root for the existing app information route.
  ipcMain.handle("app:getProjectPath", async () => {
    return app.getAppPath();
  });

  // Settings window handlers
  ipcMain.handle("window:openSettings", async (_event, payload?: unknown) => {
    if (payload === undefined) return void (await openSettingsWindow());
    if (
      !payload ||
      typeof payload !== "object" ||
      !("tab" in payload) ||
      !isSettingsTab(payload.tab)
    )
      throw new Error("Choose a valid Settings tab.");
    await openSettingsWindow(payload.tab);
  });

  ipcMain.handle("window:closeSettings", async (_event) => {
    getSettingsWindow()?.close();
  });

  registerProductivityHandlers();
  registerItemEditingHandlers();
  registerAIHandlers();
  registerAssistantHistoryHandlers();
  registerProfileHandlers();
  registerStartupHandlers();
  registerLicenseHandlers();

  logger.info("handlers", "✓ IPC handlers registered");
}
