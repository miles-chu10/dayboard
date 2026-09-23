import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { parseDesktopLicenseConfig } from "./shared/license-config.js";

const root = import.meta.dirname;
const fromRoot = (...segments: string[]) => resolve(root, ...segments);

const alias = {
  "@main": fromRoot("main"),
  "@renderer": fromRoot("renderer"),
  "@shared": fromRoot("shared"),
};

function licenseDefinitions(): Record<string, string> {
  const testBuild = process.env.DAYBOARD_TEST === "1";
  const names = [
    "DAYBOARD_LICENSE_API_URL",
    "DAYBOARD_STRIPE_PRODUCT_ID",
    "DAYBOARD_LICENSE_ENVIRONMENT",
  ] as const;
  const values = Object.fromEntries(
    names.map((name) => [name, testBuild ? "" : (process.env[name] ?? "").trim()]),
  );
  const disabled = !testBuild && process.env.DAYBOARD_LICENSE === "off";
  if (process.env.DAYBOARD_RELEASE === "1") {
    const config = parseDesktopLicenseConfig({
      apiUrl: values.DAYBOARD_LICENSE_API_URL,
      productId: values.DAYBOARD_STRIPE_PRODUCT_ID,
      environment: values.DAYBOARD_LICENSE_ENVIRONMENT,
    });
    if (testBuild || disabled || !config || config.environment !== "live") {
      throw new Error(
        "Release packaging requires DAYBOARD_LICENSE_API_URL, DAYBOARD_STRIPE_PRODUCT_ID and DAYBOARD_LICENSE_ENVIRONMENT=live, with licensing enabled.",
      );
    }
  }
  return {
    ...Object.fromEntries(
      names.map((name) => [`process.env.${name}`, JSON.stringify(values[name])]),
    ),
    "process.env.DAYBOARD_LICENSE": JSON.stringify(disabled ? "off" : "on"),
    "process.env.DAYBOARD_RELEASE": JSON.stringify(
      !testBuild && process.env.DAYBOARD_RELEASE === "1" ? "1" : "",
    ),
  };
}

// The Google Desktop OAuth client ships inside the app bundle but never lives in git. It is read at
// build time from an absolute per-user path (DAYBOARD_GOOGLE_OAUTH_FILE, else
// ~/.config/dayboard/google-oauth.json) so builds from copied/staged trees still find it. Release
// packaging (DAYBOARD_RELEASE=1, set by `npm run dist`) fails without a valid client; other builds
// warn and keep the committed empty values, so Google sign-in reports itself as not configured.
function injectGoogleOAuthClient(): Plugin {
  const file = process.env.DAYBOARD_GOOGLE_OAUTH_FILE
    ? resolve(process.env.DAYBOARD_GOOGLE_OAUTH_FILE)
    : join(homedir(), ".config", "dayboard", "google-oauth.json");
  const release = process.env.DAYBOARD_RELEASE === "1";
  const testBuild = process.env.DAYBOARD_TEST === "1";
  let warned = false;
  return {
    name: "dayboard:inject-google-oauth-client",
    load(id) {
      if (!/[\\/]main[\\/]services[\\/]google-oauth-app-client\.ts$/.test(id)) return null;
      if (testBuild) {
        if (release) this.error("A test build cannot be packaged as a release.");
        return 'export const GOOGLE_APP_CLIENT_ID = ""; export const GOOGLE_APP_CLIENT_SECRET = "";';
      }
      const client = existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as {
            clientId?: unknown;
            clientSecret?: unknown;
          })
        : null;
      if (
        typeof client?.clientId !== "string" ||
        !client.clientId.endsWith(".apps.googleusercontent.com") ||
        typeof client.clientSecret !== "string" ||
        !client.clientSecret
      ) {
        const reason = client ? `${file} has no valid clientId/clientSecret` : `${file} not found`;
        if (release) {
          this.error(`[google-oauth] ${reason}; release builds require the Desktop OAuth client.`);
        }
        if (!warned) {
          this.warn(`[google-oauth] ${reason}; this build ships without Google sign-in.`);
          warned = true;
        }
        return null;
      }
      this.addWatchFile(file);
      return (
        `export const GOOGLE_APP_CLIENT_ID = ${JSON.stringify(client.clientId)};\n` +
        `export const GOOGLE_APP_CLIENT_SECRET = ${JSON.stringify(client.clientSecret)};\n`
      );
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
    define: licenseDefinitions(),
    plugins: [injectGoogleOAuthClient()],
    build: {
      // Runtime `dependencies` stay external (shipped in node_modules); node-pty is native.
      externalizeDeps: { include: ["node-pty"] },
      rollupOptions: { input: { index: fromRoot("main/index.ts") } },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: fromRoot("electron/preload.ts") },
        // Sandboxed preloads must be CommonJS; `.cjs` because package.json is `type: module`.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root,
    resolve: { alias },
    define: {
      __APP_DISPLAY_NAME__: JSON.stringify("DayBoard"),
    },
    plugins: [react({ babel: { plugins: ["babel-plugin-react-compiler"] } }), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          main: fromRoot("main-window.html"),
          settings: fromRoot("settings-window.html"),
        },
      },
    },
  },
});
