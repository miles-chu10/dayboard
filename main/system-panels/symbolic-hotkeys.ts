import { spawn } from "node:child_process";

import { isAppStoreBuild } from "../../shared/app-store-build.js";

/**
 * Reads macOS's system shortcuts (com.apple.symbolichotkeys) as JSON, or null when that fails.
 * `globalShortcut.register` succeeds even for combinations macOS consumes first, such as ⌘Space.
 */
export function readSymbolicHotkeys(timeoutMs = 2_000): Promise<unknown> {
  // The sandbox can't read another domain's preferences.
  if (isAppStoreBuild) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const defaults = spawn("/usr/bin/defaults", ["export", "com.apple.symbolichotkeys", "-"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const plutil = spawn("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      defaults.kill();
      plutil.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    let output = "";
    defaults.on("error", () => finish(null));
    plutil.on("error", () => finish(null));
    plutil.stdin.on("error", () => finish(null));
    defaults.stdout.pipe(plutil.stdin);
    plutil.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    plutil.on("close", (code) => {
      if (code !== 0) return finish(null);
      try {
        finish(JSON.parse(output));
      } catch {
        finish(null);
      }
    });
  });
}
