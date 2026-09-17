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

export default defineConfig({
  build: {
    external: [...nodePty.externals],
    plugins: [
      nodePty.plugin,
      {
        name: "fix-node-pty-spawn-helper-exec-bit",
        setup(build) {
          build.onEnd(() => {
            chmodSpawnHelpers(path.join(getBuildOutDir(), "main", "node_modules", "node-pty"));
          });
        },
      },
    ],
  },
});
