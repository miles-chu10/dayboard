import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { Arch, Platform, build } from "electron-builder";

const EXCLUDED_MODULES = ["node-pty", "electron-updater"];

/** Fails unless the app is sandboxed, carries its profile and ships no CLI, PTY or updater code. */
export function verifyMasApp(app, { entitlements, asarEntries, unpacked }) {
  if (!/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/.test(entitlements)) {
    throw new Error("The App Store app is not signed with the App Sandbox entitlement.");
  }
  if (!existsSync(path.join(app, "Contents", "embedded.provisionprofile"))) {
    throw new Error("The App Store app has no embedded provisioning profile.");
  }
  for (const name of EXCLUDED_MODULES) {
    const prefix = `${path.sep}node_modules${path.sep}${name}`;
    if (asarEntries.some((entry) => entry === prefix || entry.startsWith(`${prefix}${path.sep}`))) {
      throw new Error(`The App Store app must not bundle ${name}.`);
    }
    if (unpacked.includes(name)) throw new Error(`The App Store app must not unpack ${name}.`);
  }
}

export async function packageMas(development = false) {
  if (process.platform !== "darwin") throw new Error("App Store packaging requires macOS.");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (!existsSync(path.join(root, "out", "main", "mas-build.json"))) {
    throw new Error("Build with DAYBOARD_MAS=1 first (npm run build:mas).");
  }
  const profile = process.env.DAYBOARD_MAS_PROVISIONING_PROFILE;
  if (!profile || !existsSync(profile)) {
    throw new Error(
      "Set DAYBOARD_MAS_PROVISIONING_PROFILE to the App Store (or, with --dev, development) provisioning profile.",
    );
  }
  const target = development ? "mas-dev" : "mas";
  await build({
    projectDir: root,
    publish: "never",
    config: {
      extends: path.join(root, "electron-builder.yml"),
      directories: { output: "release-mas" },
      [development ? "masDev" : "mas"]: { provisioningProfile: path.resolve(profile) },
    },
    targets: Platform.MAC.createTarget(target, Arch.arm64),
  });

  const app = path.join(root, "release-mas", `${target}-arm64`, "DayBoard.app");
  const signature = spawnSync(
    "/usr/bin/codesign",
    ["--display", "--entitlements", "-", "--xml", app],
    { encoding: "utf8" },
  );
  if (signature.error) throw signature.error;
  if (signature.status !== 0) throw new Error("Could not read the App Store app's entitlements.");
  const resources = path.join(app, "Contents", "Resources");
  const unpackedDir = path.join(resources, "app.asar.unpacked", "node_modules");
  verifyMasApp(app, {
    entitlements: signature.stdout,
    asarEntries: listPackage(path.join(resources, "app.asar"), { isPack: false }),
    unpacked: EXCLUDED_MODULES.filter((name) => existsSync(path.join(unpackedDir, name))),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--dev")) {
    throw new Error("Usage: node scripts/package-mas.mjs [--dev]");
  }
  await packageMas(args[0] === "--dev");
}
