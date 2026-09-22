import { defineConfig, externalizePackage } from "@glaze/core/build";
import fs from "fs";
import os from "os";
import path from "path";

// node-pty is a native module: keep it out of the bundle and make its helper executable.
const nodePty = externalizePackage("node-pty");

function getBuildOutDir() {
  if (process.env.GLAZE_BUILD_OUT_DIR) {
    return path.resolve(process.cwd(), process.env.GLAZE_BUILD_OUT_DIR);
  }

  const runtimeBuildDir = path.resolve(process.cwd(), "../runtime/build");
  if (fs.existsSync(path.dirname(runtimeBuildDir))) return runtimeBuildDir;
  return path.resolve(process.cwd(), "build");
}

function chmodSpawnHelpers(root: string) {
  if (!fs.existsSync(root)) return;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      chmodSpawnHelpers(entryPath);
      continue;
    }
    if (entry.name === "spawn-helper") {
      fs.chmodSync(entryPath, 0o755);
    }
  }
}

// Google Desktop OAuth client lives at a fixed per-user path, outside any source tree, so every
// build (local or Glaze's publish staging copy) finds it. Missing or invalid => the build fails.
const googleOAuthFile = path.join(os.homedir(), ".config", "dayboard", "google-oauth.json");

function readGoogleOAuthClient(): { clientId: string; clientSecret: string } {
  if (!fs.existsSync(googleOAuthFile)) {
    throw new Error(
      `[google-oauth] ${googleOAuthFile} not found. Add { "clientId", "clientSecret" } for the Desktop OAuth client before building.`,
    );
  }
  const { clientId, clientSecret } = JSON.parse(fs.readFileSync(googleOAuthFile, "utf8")) as {
    clientId?: unknown;
    clientSecret?: unknown;
  };
  if (
    typeof clientId !== "string" ||
    !clientId.endsWith(".apps.googleusercontent.com") ||
    typeof clientSecret !== "string" ||
    !clientSecret
  ) {
    throw new Error(`[google-oauth] ${googleOAuthFile} is missing a valid clientId/clientSecret.`);
  }
  return { clientId, clientSecret };
}

export default defineConfig({
  build: {
    external: [...nodePty.externals],
    plugins: [
      nodePty.plugin,
      {
        name: "inject-google-oauth-client",
        setup(build) {
          build.onLoad({ filter: /google-oauth-app-client\.ts$/ }, () => {
            const { clientId, clientSecret } = readGoogleOAuthClient();
            return {
              contents:
                `export const GOOGLE_APP_CLIENT_ID = ${JSON.stringify(clientId)};\n` +
                `export const GOOGLE_APP_CLIENT_SECRET = ${JSON.stringify(clientSecret)};\n`,
              loader: "ts",
              watchFiles: [googleOAuthFile],
            };
          });
        },
      },
      {
        name: "fix-node-pty-spawn-helper-exec-bit",
        setup(build) {
          build.onEnd(() => {
            chmodSpawnHelpers(
              path.join(getBuildOutDir(), "main", "node_modules", "node-pty"),
            );
          });
        },
      },
    ],
  },
});
