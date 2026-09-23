import { ipcMain } from "../platform/index.js";

import { assertNotDemo, isDemoMode } from "../services/demo-data.js";
import { getStartAtLogin, setStartAtLogin } from "../services/startup-settings.js";

function requireBoolean(payload: unknown): boolean {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { openAtLogin?: unknown }).openAtLogin !== "boolean"
  )
    throw new Error("startup:setLoginItem: openAtLogin must be a boolean");
  return (payload as { openAtLogin: boolean }).openAtLogin;
}

export function registerStartupHandlers(): void {
  ipcMain.handle("startup:getLoginItem", () =>
    isDemoMode() ? { openAtLogin: false, status: "not-registered" } : getStartAtLogin(),
  );
  ipcMain.handle("startup:setLoginItem", (_event, payload: unknown) => {
    assertNotDemo("startup:setLoginItem");
    return setStartAtLogin(requireBoolean(payload));
  });
}
