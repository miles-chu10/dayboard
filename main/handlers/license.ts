import { ipcMain } from "../platform/index.js";
import { LICENSE_RESET_CONFIRMATION } from "../../shared/license.js";
import {
  activateLicense,
  deactivateLicense,
  getLicenseStatus,
  refreshLicenseStatus,
  resetUnreadableLicense,
  type LicenseStatusPayload,
} from "../services/license/index.js";

const INSTANCE_NAME = "DayBoard on macOS";

function broadcastChange(payload: LicenseStatusPayload): LicenseStatusPayload {
  ipcMain.broadcast("license:changed", {
    status: payload.status,
    checkoutUrl: payload.checkoutUrl,
  });
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

  // Returns `release` too, so the caller can say whether the slot was confirmed free.
  ipcMain.handle("license:deactivate", async () => {
    const result = await deactivateLicense();
    broadcastChange(result);
    return result;
  });

  ipcMain.handle("license:reset", async (_event, confirmation: unknown) => {
    if (confirmation !== LICENSE_RESET_CONFIRMATION) {
      throw new Error("Confirm resetting license data on this Mac first.");
    }
    return broadcastChange(await resetUnreadableLicense());
  });
}
