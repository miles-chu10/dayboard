// Renders the menu-bar template images from brand/dayboard-icon-small.svg: the Fraunces "D" and
// the three dots inside its counter, in black on a transparent background. Run with:
//   npx electron scripts/build-tray-icons.mjs
// macOS tints template images for light and dark menu bars, so only the alpha channel matters.
// Each size renders in its own process: pass "16" or "32" (default: both, sequentially).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const root = path.join(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "brand", "dayboard-icon-small.svg"), "utf8");
const fontFace = source.match(/<style>[\s\S]*?<\/style>/)[0];
const text = source.match(/<text[\s\S]*?<\/text>/)[0].replace(/fill="#[0-9a-f]+"/i, 'fill="#000"');
const dots = [...source.matchAll(/<circle [^>]*\/>/g)]
  .map((match) => match[0].replace(/fill="#[0-9a-f]+"/i, 'fill="#000"'))
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 120 724 724">
<defs>${fontFace}</defs>${text}${dots}</svg>`;

const NAMES = { 16: "trayTemplate.png", 32: "trayTemplate@2x.png", 128: "preview.png" };
const requested = Number(process.argv.at(-1));

if (!NAMES[requested]) {
  for (const size of [16, 32])
    execFileSync(process.execPath, [import.meta.filename, String(size)], { stdio: "inherit" });
  process.exit(0);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const size = requested;
  const window = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}"></body></html>`;
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const target =
    size === 128
      ? path.join(os.tmpdir(), NAMES[size])
      : path.join(root, "resources", "tray", NAMES[size]);
  fs.writeFileSync(target, image.resize({ width: size, height: size }).toPNG());
  console.log(`wrote ${target}`);
  app.quit();
});
