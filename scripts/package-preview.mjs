import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signAsync } from "@electron/osx-sign";
import { Arch, Platform, build } from "electron-builder";

export function assertAdHocSignature(details) {
  if (
    !/^Signature=adhoc$/m.test(details) ||
    !/^TeamIdentifier=not set$/m.test(details) ||
    /^Authority=/m.test(details) ||
    /flags=.*\bruntime\b/.test(details)
  ) {
    throw new Error(
      "Preview packages must have an ad-hoc signature without a signing team or hardened runtime.",
    );
  }
}

export async function packagePreview(testOnly = false) {
  if (process.platform !== "darwin") throw new Error("Preview packaging requires macOS.");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const app = path.join(root, "release", "mac-arm64", "DayBoard.app");
  const options = {
    projectDir: root,
    publish: "never",
    config: {
      extends: path.join(root, "electron-builder.yml"),
      // null skips electron-builder's identity lookup, including explicit CSC_NAME values.
      mac: { identity: null, hardenedRuntime: false, notarize: false },
      dmg: { sign: false },
    },
  };
  await build({ ...options, targets: Platform.MAC.createTarget("dir", Arch.arm64) });

  // Sign only after packaging/fuse edits, and before either archive is assembled.
  // identityValidation:false passes the literal '-' directly to codesign, without a keychain search.
  await signAsync({
    app,
    platform: "darwin",
    identity: "-",
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    gatekeeperAssess: false,
    strictVerify: true,
    binaries: [path.join(app, "Contents", "Resources", "bin", "reminders-helper")],
    optionsForFile: () => ({
      entitlements: path.join(root, "build", "entitlements.mac.plist"),
      hardenedRuntime: false,
      timestamp: "none",
    }),
  });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const signature = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", app], {
    encoding: "utf8",
  });
  if (signature.error) throw signature.error;
  if (signature.status !== 0) throw new Error("Could not inspect the preview signature.");
  assertAdHocSignature(signature.stderr);

  if (!testOnly) {
    await build({
      ...options,
      prepackaged: app,
      targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.arm64),
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--test")) {
    throw new Error("Usage: node scripts/package-preview.mjs [--test]");
  }
  await packagePreview(args[0] === "--test");
}
