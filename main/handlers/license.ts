import { ipcMain } from "../platform/index.js";
import {
  activateLicense,
  deactivateLicense,
  getLicenseStatus,
  refreshLicenseStatus,
  type LicenseStatusPayload,
} from "../services/license/index.js";

const INSTANCE_NAME = "DayBoard on macOS";

function broadcastChange(payload: LicenseStatusPayload): LicenseStatusPayload {
  ipcMain.broadcast("license:changed", payload);
  return payload;
}

export function registerLicenseHandlers(): void {
  ipcMain.handle("license:status", async () => getLicenseStatus());

  ipcMain.handle("license:refresh", async () => broadcastChange(await refreshLicenseStatus()));

  ipcMain.handle("license:activate", async (_event, rawKey: unknown) => {
    if (typeof rawKey !== "string" || !rawKey.trim()) {
      throw new Error("Enter a license key.");
    }
    return broadcastChange(await activateLicense(rawKey.trim(), INSTANCE_NAME));
  });

  ipcMain.handle("license:deactivate", async () => broadcastChange(await deactivateLicense()));
}
