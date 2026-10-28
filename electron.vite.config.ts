import { homedir } from "node:os";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { createBetaBuildProofPlugin } from "./shared/beta-build.js";
import { createGoogleOAuthClientPlugin } from "./shared/google-oauth-build.js";
import { createMasBuildProofPlugin } from "./shared/mas-build.js";
import { createQaBuildProofPlugin } from "./shared/qa-build.js";
import { parseDesktopLicenseConfig } from "./shared/license-config.js";

const root = import.meta.dirname;
const fromRoot = (...segments: string[]) => resolve(root, ...segments);
let googleConfigured = false;
const qaBuild = process.env.DAYBOARD_QA === "1";
const masBuild = process.env.DAYBOARD_MAS === "1";
if (
  masBuild &&
  (qaBuild ||
    process.env.DAYBOARD_TEST === "1" ||
    process.env.DAYBOARD_RELEASE === "1" ||
    process.env.DAYBOARD_LICENSE !== "off")
) {
  // The App Store owns updates and purchases (App Review 2.4.5 and 3.1.1).
  throw new Error(
    "App Store builds require DAYBOARD_LICENSE=off and no test, QA or release flags.",
  );
}
if (
  qaBuild &&
  (process.env.DAYBOARD_TEST === "1" ||
    process.env.DAYBOARD_RELEASE === "1" ||
    process.env.DAYBOARD_REQUIRE_GOOGLE === "1")
) {
  throw new Error("QA builds cannot enable test, release or Google-required packaging.");
}

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
  const disabled = qaBuild || (!testBuild && process.env.DAYBOARD_LICENSE === "off");
  // Builds with licensing off never carry the license service configuration.
  const values = Object.fromEntries(
    names.map((name) => [name, testBuild || disabled ? "" : (process.env[name] ?? "").trim()]),
  );
  // DAYBOARD_RELEASE=1 enables in-app updates. With licensing off it is a free release;
  // otherwise it must carry the live license service configuration.
  if (process.env.DAYBOARD_RELEASE === "1") {
    const config = parseDesktopLicenseConfig({
      apiUrl: values.DAYBOARD_LICENSE_API_URL,
      productId: values.DAYBOARD_STRIPE_PRODUCT_ID,
      environment: values.DAYBOARD_LICENSE_ENVIRONMENT,
    });
    if (testBuild || (!disabled && config?.environment !== "live")) {
      throw new Error(
        "Release packaging requires DAYBOARD_LICENSE=off for a free release, or DAYBOARD_LICENSE_API_URL, DAYBOARD_STRIPE_PRODUCT_ID and DAYBOARD_LICENSE_ENVIRONMENT=live with licensing enabled.",
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
      __DAYBOARD_QA_BUILD__: JSON.stringify(qaBuild),
      __DAYBOARD_MAS_BUILD__: JSON.stringify(masBuild),
    },
    plugins: [
      createGoogleOAuthClientPlugin({
        file: process.env.DAYBOARD_GOOGLE_OAUTH_FILE
          ? resolve(process.env.DAYBOARD_GOOGLE_OAUTH_FILE)
          : join(homedir(), ".config", "dayboard", "google-oauth.json"),
        required:
          process.env.DAYBOARD_RELEASE === "1" ||
          process.env.DAYBOARD_REQUIRE_GOOGLE === "1" ||
          masBuild,
        testBuild: process.env.DAYBOARD_TEST === "1" || qaBuild,
        onConfigured: () => {
          googleConfigured = true;
        },
      }),
      ...(qaBuild ? [createQaBuildProofPlugin()] : []),
      ...(masBuild ? [createMasBuildProofPlugin()] : []),
      // Local beta packages are ad-hoc signed, so the proof also rejects an updater build.
      ...(process.env.DAYBOARD_REQUIRE_GOOGLE === "1"
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
      __APP_DISPLAY_NAME__: JSON.stringify(qaBuild ? "DayBoard QA" : "DayBoard"),
      __DAYBOARD_MAS_BUILD__: JSON.stringify(masBuild),
    },
    plugins: [react({ babel: { plugins: ["babel-plugin-react-compiler"] } }), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          main: fromRoot("main-window.html"),
          settings: fromRoot("settings-window.html"),
          panel: fromRoot("panel-window.html"),
        },
      },
    },
  },
});
