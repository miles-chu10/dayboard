import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, uncache } from "@electron/asar";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function verifyBetaBuild(read) {
  try {
    const proof = JSON.parse(read("beta-build.json").toString());
    if (
      proof.schema !== 1 ||
      proof.googleConfigured !== true ||
      proof.licensingDisabled !== true ||
      proof.updatesEnabled !== false ||
      proof.testBuild !== false ||
      !proof.files?.["index.js"]
    )
      throw new Error();
    for (const [name, hash] of Object.entries(proof.files)) {
      if (
        !/^(?:[\w-]+\/)*[\w.-]+\.js$/.test(name) ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        sha256(read(name)) !== hash
      )
        throw new Error();
    }
  } catch {
    // Never include parsed build data, source code or OAuth values in diagnostics.
    throw new Error("Beta configuration verification failed. Rebuild with npm run package:beta.");
  }
}

export function verifyBetaApp(app) {
  const archive = path.join(app, "Contents", "Resources", "app.asar");
  uncache(archive);
  verifyBetaBuild((name) => extractFile(archive, `out/main/${name}`));
  const pkg = JSON.parse(extractFile(archive, "package.json").toString());
  if (pkg.main !== "out/main/index.js") throw new Error("Unexpected packaged application entry.");
  return sha256(readFileSync(archive));
}

export function verifyBetaArtifacts(app, artifacts) {
  if (process.platform !== "darwin") throw new Error("Beta archive verification requires macOS.");
  const expected = verifyBetaApp(app);
  const archives = artifacts.filter((file) => /\.(dmg|zip)$/.test(file));
  if (
    archives.length !== 2 ||
    !archives.some((file) => file.endsWith(".dmg")) ||
    !archives.some((file) => file.endsWith(".zip"))
  )
    throw new Error("Beta packaging must produce one DMG and one ZIP.");
  const directory = mkdtempSync(path.join(tmpdir(), "dayboard-beta-verify-"));
  const run = (command, args) => execFileSync(command, args, { stdio: "pipe" });
  function verifyExtracted(folder) {
    const extracted = path.join(folder, "DayBoard.app");
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", extracted]);
    if (verifyBetaApp(extracted) !== expected) {
      throw new Error("Beta archive does not match the verified application.");
    }
  }
  try {
    const zip = path.join(directory, "zip");
    mkdirSync(zip);
    run("/usr/bin/ditto", ["-x", "-k", archives.find((file) => file.endsWith(".zip")), zip]);
    verifyExtracted(zip);
    const mount = path.join(directory, "dmg");
    mkdirSync(mount);
    const dmg = archives.find((file) => file.endsWith(".dmg"));
    run("/usr/bin/hdiutil", ["verify", dmg]);
    run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
    try {
      verifyExtracted(mount);
    } finally {
      run("/usr/bin/hdiutil", ["detach", mount]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  console.log(
    "Beta app, DMG and ZIP verified: Google configured; licensing, updates and test mode off.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, ...artifacts] = process.argv.slice(2);
  if (!app) throw new Error("Usage: node scripts/verify-beta-package.mjs <app> <dmg> <zip>");
  verifyBetaArtifacts(
    path.resolve(app),
    artifacts.map((file) => path.resolve(file)),
  );
}
