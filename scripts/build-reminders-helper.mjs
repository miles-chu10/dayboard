#!/usr/bin/env node
// Compiles native/reminders-helper/main.swift into resources/bin/reminders-helper (gitignored
// build output, shipped via electron-builder extraResources to Contents/Resources/bin). Requires
// Xcode command line tools (`xcrun swiftc`); arm64, macOS 14 minimum deployment target.
//
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "native", "reminders-helper", "main.swift");
const support = join(root, "native", "reminders-helper", "RemindersInput.swift");
const outDir = join(root, "resources", "bin");
const output = join(outDir, "reminders-helper");

mkdirSync(outDir, { recursive: true });

const args = ["swiftc", "-O", "-target", "arm64-apple-macos14", source, support, "-o", output];

console.log(`[build-reminders-helper] xcrun ${args.join(" ")}`);
const result = spawnSync("xcrun", args, { stdio: "inherit" });
if (result.status !== 0) {
  console.error("[build-reminders-helper] swiftc failed");
  process.exit(result.status ?? 1);
}
console.log(`[build-reminders-helper] built ${output}`);
