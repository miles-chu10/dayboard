// EXAMPLE VIEW - Replace this entire component
//
// This template uses IPC APIs with a secure preload pattern.
//
// === SECURITY MODEL ===
// - Renderer code should NOT import ipcRenderer directly
// - Use contextBridge in a preload script to expose specific APIs
// - Channel names follow channel naming convention: "module:method" (e.g., "dialog:showOpenDialog")
//
// === PRELOAD SCRIPT (preload.ts) ===
// ```
// import { ipcRenderer, contextBridge } from '@glaze/core/preload';
//
// contextBridge.exposeInMainWorld('myAppAPI', {
//   getInfo: () => ipcRenderer.invoke('app:getInfo'),
//   saveFile: (name: string, data: string) => ipcRenderer.invoke('file:save', { name, data }),
//   showOpenDialog: (options: any) => ipcRenderer.invoke('dialog:showOpenDialog', options),
// });
// ```
//
// === RENDERER CODE (your components) ===
// ```
// // Only use the exposed API - no direct ipcRenderer access
// const info = await window.myAppAPI.getInfo();
// await window.myAppAPI.saveFile('test.txt', 'hello');
// const result = await window.myAppAPI.showOpenDialog({ properties: ['openFile'] });
// ```
//
// === BACKEND HANDLERS (main/handlers/index.ts) ===
// ```
// import { ipcMain, dialog } from '@glaze/core/backend';
//
// // Custom handler
// ipcMain.handle('app:getInfo', async () => {
//   return { name: 'My App', version: '1.0.0' };
// });
//
// // Built-in modules work directly through the Glaze APIs
// // The native API handlers are already registered for:
// //   dialog:showOpenDialog, dialog:showSaveDialog, dialog:showMessageBox
// //   shell:openPath, shell:openExternal, shell:trashItem, shell:beep
// //   screen:getPrimaryDisplay, screen:getAllDisplays, etc.
// //   clipboard:readText, clipboard:writeText
// //   nativeTheme:getInfo, nativeTheme:setThemeSource
// //   Menu:setApplicationMenu, Menu:popup
// ```

import { Toolbar, ToolbarContent, ToolbarTitle } from "@glaze/core/components";

declare const __APP_DISPLAY_NAME__: string | undefined;

export function HomeView() {
  return (
    <div className="h-full flex flex-col">
      <Toolbar>
        <ToolbarContent>
          <ToolbarTitle>{/* Page title */}</ToolbarTitle>
        </ToolbarContent>
      </Toolbar>
      <div className="h-full flex flex-col gap-2 w-full text-center absolute inset-0 justify-center items-center">
        <h1 className="text-heading1 font-normal shimmer-text">
          {__APP_DISPLAY_NAME__ || "Glaze App"}
        </h1>
      </div>
    </div>
  );
}
