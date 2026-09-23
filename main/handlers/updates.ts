import { app, ipcMain } from "../platform/index.js";
import { isDemoMode } from "../services/demo-data.js";
import { createAppUpdates, type UpdateClient } from "../services/app-updates.js";

export interface UpdateHandlerOptions {
  prepareForInstall: () => Promise<void>;
  resumeAfterInstallFailure: () => void;
}

export function registerUpdateHandlers(options: UpdateHandlerOptions) {
  const updates = createAppUpdates({
    isOfficialRelease: process.env.DAYBOARD_RELEASE === "1",
    isPackaged: app.isPackaged,
    isDemo: isDemoMode,
    currentVersion: app.getVersion(),
    loadUpdater: async () => {
      const module = await import("electron-updater");
      // electron-updater is CommonJS; this also works in the bundled ESM main process.
      const updater = module.autoUpdater ?? module.default?.autoUpdater;
      if (!updater) throw new Error("The update service is unavailable.");
      return updater as unknown as UpdateClient;
    },
    prepareForInstall: options.prepareForInstall,
    resumeAfterInstallFailure: options.resumeAfterInstallFailure,
    onChange: (state) => ipcMain.broadcast("updates:changed", state),
  });

  ipcMain.handle("updates:status", () => updates.status());
  ipcMain.handle("updates:check", () => updates.check());
  ipcMain.handle("updates:download", () => updates.download());
  ipcMain.handle("updates:install", () => updates.install());
  return updates;
}
