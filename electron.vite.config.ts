import { homedir } from "node:os";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { createBetaBuildProofPlugin } from "./shared/beta-build.js";
import { createGoogleOAuthClientPlugin } from "./shared/google-oauth-build.js";
import { parseDesktopLicenseConfig } from "./shared/license-config.js";

const root = import.meta.dirname;
const fromRoot = (...segments: string[]) => resolve(root, ...segments);
let googleConfigured = false;

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

export default defineConfig({
  main: {
    resolve: { alias },
    define: {
      ...licenseDefinitions(),
      __DAYBOARD_TEST_BUILD__: JSON.stringify(process.env.DAYBOARD_TEST === "1"),
    },
    plugins: [
      createGoogleOAuthClientPlugin({
        file: process.env.DAYBOARD_GOOGLE_OAUTH_FILE
          ? resolve(process.env.DAYBOARD_GOOGLE_OAUTH_FILE)
          : join(homedir(), ".config", "dayboard", "google-oauth.json"),
        required:
          process.env.DAYBOARD_RELEASE === "1" || process.env.DAYBOARD_REQUIRE_GOOGLE === "1",
        testBuild: process.env.DAYBOARD_TEST === "1",
        onConfigured: () => {
          googleConfigured = true;
        },
      }),
      ...(process.env.DAYBOARD_REQUIRE_GOOGLE === "1" && process.env.DAYBOARD_RELEASE !== "1"
        ? [createBetaBuildProofPlugin(() => googleConfigured)]
        : []),
    ],
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
