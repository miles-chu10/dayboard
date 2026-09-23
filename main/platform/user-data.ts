// Applies DAYBOARD_USER_DATA (override app.getPath("userData")) and DAYBOARD_DEMO=1 (mark demo
// mode via a userData/demo-mode file, read by main/services/demo-data.ts) before the app is
// ready. Call configureUserData() once, at import time, from main/platform/index.ts.

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

let configured = false;

export function configureUserData(): void {
  if (configured) return;
  configured = true;

  const override = process.env.DAYBOARD_USER_DATA;
  if (override) app.setPath("userData", path.resolve(override));

  if (process.env.DAYBOARD_DEMO === "1") {
    const userData = app.getPath("userData");
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, "demo-mode"), "");
  }
}
