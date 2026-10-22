# Menu-bar icon

`trayTemplate.png` (16 × 16) and `trayTemplate@2x.png` (32 × 32) are macOS template images: the
DayBoard "D" and its three dots in black on a transparent background, drawn from
`brand/dayboard-icon-small.svg`, kept beside `tray.ts` so electron-vite copies them into the build (files under `resources/` would not ship inside `app.asar`). macOS tints them for light and dark menu bars.

Regenerate with `npx electron scripts/build-tray-icons.mjs` (one Electron process per size).
