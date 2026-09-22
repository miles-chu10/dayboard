import { defineConfig, externalizePackage } from "@glaze/core/build";
import fs from "fs";
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

// Google Desktop OAuth client: real values come from google-oauth.local.json in the Glaze project
// folder (the parent of sources), so the file is never part of the published source tree.
const googleOAuthLocalFile = path.resolve(
  process.cwd(),
  "../google-oauth.local.json",
);

export default defineConfig({
  build: {
    external: [...nodePty.externals],
    plugins: [
      nodePty.plugin,
      {
        name: "inject-google-oauth-client",
        setup(build) {
          build.onLoad({ filter: /google-oauth-app-client\.ts$/ }, () => {
            if (!fs.existsSync(googleOAuthLocalFile)) {
              console.warn(
                "[google-oauth] ../google-oauth.local.json not found; this build ships without Google sign-in.",
              );
              return undefined;
            }
            const { clientId, clientSecret } = JSON.parse(
              fs.readFileSync(googleOAuthLocalFile, "utf8"),
            ) as { clientId?: string; clientSecret?: string };
            return {
              contents:
                `export const GOOGLE_APP_CLIENT_ID = ${JSON.stringify(clientId ?? "")};\n` +
                `export const GOOGLE_APP_CLIENT_SECRET = ${JSON.stringify(clientSecret ?? "")};\n`,
              loader: "ts",
              watchFiles: [googleOAuthLocalFile],
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
