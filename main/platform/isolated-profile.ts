import * as fs from "node:fs";
import * as path from "node:path";

export type IsolatedProfileMode = "demo" | "test";
export const ISOLATED_PROFILE_MARKER = ".dayboard-isolated-profile.json";

function canonicalPath(value: string): string {
  let ancestor = path.resolve(value);
  const suffix: string[] = [];
  while (true) {
    try {
      return path.join(fs.realpathSync(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        fs.lstatSync(ancestor);
        throw new Error("Could not verify the profile directory.");
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error("Could not verify the profile directory.");
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function comparablePath(value: string): string {
  const canonical = canonicalPath(value);
  return process.platform === "darwin" ? canonical.normalize("NFC").toLowerCase() : canonical;
}

function containsDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function resolveProfileOverride(value: string, reservedDirectories: string[] = []): string {
  if (!value || value !== value.trim() || !path.isAbsolute(value)) {
    throw new Error("DAYBOARD_USER_DATA must be an absolute, nonempty profile directory.");
  }
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("The profile override must be an existing directory, not a symlink.");
  }
  const target = comparablePath(value);
  for (const reserved of reservedDirectories) {
    const normal = comparablePath(reserved);
    if (containsDirectory(normal, target) || containsDirectory(target, normal)) {
      throw new Error("Test/demo profiles must be separate from the default DayBoard profile.");
    }
  }
  return fs.realpathSync(value);
}

export function validateIsolatedProfile(directory: string, mode: IsolatedProfileMode): string {
  const target = resolveProfileOverride(directory);
  const stat = fs.statSync(target);
  if (process.getuid && stat.uid !== process.getuid()) {
    throw new Error("The isolated profile must belong to the current account.");
  }
  const marker = path.join(target, ISOLATED_PROFILE_MARKER);
  const entries = fs.readdirSync(target);
  if (entries.includes(ISOLATED_PROFILE_MARKER)) {
    const markerStat = fs.lstatSync(marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1) {
      throw new Error("The isolated-profile marker must be a regular file.");
    }
    let saved: unknown;
    try {
      saved = JSON.parse(fs.readFileSync(marker, "utf8"));
    } catch {
      throw new Error("The isolated-profile marker is invalid.");
    }
    if (
      !saved ||
      typeof saved !== "object" ||
      !("version" in saved) ||
      saved.version !== 1 ||
      !("mode" in saved) ||
      saved.mode !== mode
    ) {
      throw new Error("The isolated-profile marker does not match the requested mode.");
    }
  } else if (entries.length !== 0) {
    throw new Error("Test/demo startup cannot adopt an existing unmarked profile.");
  }
  const demoMarker = path.join(target, "demo-mode");
  if (mode === "demo") {
    if (fs.existsSync(demoMarker)) {
      const demoStat = fs.lstatSync(demoMarker);
      if (!demoStat.isFile() || demoStat.isSymbolicLink() || demoStat.nlink !== 1) {
        throw new Error("The demo marker must be a regular file.");
      }
    }
  } else if (fs.existsSync(demoMarker)) {
    throw new Error("A demo profile cannot be used for a normal test session.");
  }
  return target;
}

export function prepareIsolatedProfile(directory: string, mode: IsolatedProfileMode): string {
  const target = validateIsolatedProfile(directory, mode);
  const marker = path.join(target, ISOLATED_PROFILE_MARKER);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, JSON.stringify({ version: 1, mode }) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  const demoMarker = path.join(target, "demo-mode");
  if (mode === "demo" && !fs.existsSync(demoMarker)) {
    fs.writeFileSync(demoMarker, "", { flag: "wx", mode: 0o600 });
  }
  return target;
}
