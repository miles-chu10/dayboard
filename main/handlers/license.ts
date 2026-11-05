import { ipcMain } from "../platform/index.js";
import {
  LICENSE_FORGET_CONFIRMATION,
  LICENSE_INSTANCE_NAME,
  LICENSE_RESET_CONFIRMATION,
} from "../../shared/license.js";
import {
  activateLicense,
  deactivateLicense,
  forgetPendingLicenseReleases,
  getLicenseStatus,
  onLicenseChange,
  refreshLicenseStatus,
  resetUnreadableLicense,
  type LicenseStatusPayload,
} from "../services/license/index.js";

function broadcastChange(payload: LicenseStatusPayload): LicenseStatusPayload {
  ipcMain.broadcast("license:changed", {
    status: payload.status,
    checkoutUrl: payload.checkoutUrl,
    releasePending: payload.releasePending ?? false,
  });
  return payload;
}

export function registerLicenseHandlers(): void {
  // A background release retry that confirms clears the pending-release warning in open windows.
  onLicenseChange(() => {
    void getLicenseStatus().then(broadcastChange, () => undefined);
  });

  ipcMain.handle("license:status", async () => getLicenseStatus());

  ipcMain.handle("license:refresh", async () => broadcastChange(await refreshLicenseStatus()));

  ipcMain.handle("license:activate", async (_event, rawKey: unknown) => {
    if (typeof rawKey !== "string" || !rawKey.trim()) {
      throw new Error("Enter a license key.");
    }
    return broadcastChange(await activateLicense(rawKey.trim(), LICENSE_INSTANCE_NAME));
  });

  // Returns `release` too, so the caller can say whether the slot was confirmed free.
  ipcMain.handle("license:deactivate", async () => {
    const result = await deactivateLicense();
    broadcastChange(result);
    return result;
  });

  ipcMain.handle("license:forget-release", async (_event, confirmation: unknown) => {
    if (confirmation !== LICENSE_FORGET_CONFIRMATION) {
      throw new Error("Confirm deleting the saved license key without releasing it first.");
    }
    return broadcastChange(await forgetPendingLicenseReleases());
  });

  ipcMain.handle("license:reset", async (_event, confirmation: unknown) => {
    if (confirmation !== LICENSE_RESET_CONFIRMATION) {
      throw new Error("Confirm resetting license data on this Mac first.");
    }
    return broadcastChange(await resetUnreadableLicense());
  });
}
