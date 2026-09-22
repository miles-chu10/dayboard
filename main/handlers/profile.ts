import { ipcMain } from "@glaze/core/backend";

import {
  clearProfileAvatar,
  getProfileAvatar,
  pickProfileAvatar,
} from "../services/profile-avatar.js";

export function registerProfileHandlers(): void {
  ipcMain.handle("profile:getAvatar", async () => {
    return { dataUrl: await getProfileAvatar() };
  });

  ipcMain.handle("profile:pickAvatar", async () => {
    const dataUrl = await pickProfileAvatar();
    ipcMain.broadcast("profile:changed", { dataUrl });
    return { dataUrl };
  });

  ipcMain.handle("profile:clearAvatar", async () => {
    await clearProfileAvatar();
    ipcMain.broadcast("profile:changed", { dataUrl: null });
    return { dataUrl: null };
  });
}
