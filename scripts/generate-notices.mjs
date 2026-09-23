import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".css"]);
const licenseName = /^(?:licen[cs]e|copying)(?:[._-].*)?$/i;
const noticeName = /^notice(?:[._-].*)?$/i;

function packageRoot(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("#") ||
    /^@(?:main|renderer|shared)\//.test(specifier)
  )
    return null;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length < 2 ? null : `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0] || null;
}

function rendererImports(root) {
  const dir = join(root, "renderer");
  const imports = new Set();
  if (!existsSync(dir)) return imports;
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "dev") visit(path);
        continue;
      }
      if (
        !entry.isFile() ||
        /(?:^|\.)test\./.test(entry.name) ||
        !sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))
      )
        continue;
      const source = readFileSync(path, "utf8");
      const patterns = [
        /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /@(?:import|use)\s+["']([^"']+)["']/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const name = packageRoot(match[1]);
          if (name) imports.add(name);
        }
      }
    }
  };
  visit(dir);
  return imports;
}

function resolveInstalled(name, from, root) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
    throw new Error(`Invalid package name: ${name}`);
  let current = from;
  const boundary = resolve(root);
  while (current === boundary || current.startsWith(`${boundary}${sep}`)) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function licenseFiles(path) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") visit(full);
      else if (entry.isFile() && (licenseName.test(entry.name) || noticeName.test(entry.name))) {
        files.push({
          name: relative(path, full).split(sep).join("/"),
          text: readFileSync(full, "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n",
        });
      } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        const header = readFileSync(full, "utf8")
          .replace(/\r\n/g, "\n")
          .match(/^(?:\/\/[^\n]*\n)+/)?.[0];
        if (
          header &&
          /Licensed under/i.test(header) &&
          /Copyright/i.test(header) &&
          /Redistribution and use/i.test(header)
        ) {
          files.push({
            name: `${relative(path, full).split(sep).join("/")} (license header)`,
            text: header.replace(/^\/\/ ?/gm, "").trimEnd() + "\n",
          });
        }
      }
    }
  };
  visit(path);
  return files;
}

function applyOverrides(root, packages) {
  const directory = join(root, "licenses", "overrides");
  const manifestPath = join(directory, "manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.entries)) throw new Error("Invalid license override manifest");
  const seen = new Set();
  const exactPackage = (entry) => {
    const matches = packages.filter((candidate) => candidate.identity.startsWith(`${entry.name}@`));
    if (matches.length !== 1 || matches[0].identity !== `${entry.name}@${entry.version}`)
      throw new Error(
        `License override for ${entry.name}@${entry.version} does not match the installed version`,
      );
    return matches[0];
  };
  for (const entry of manifest.entries) {
    if (
      !entry ||
      typeof entry.name !== "string" ||
      typeof entry.version !== "string" ||
      !/^[a-z0-9._-]+\.LICENSE$/i.test(entry.file) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !/^[a-f0-9]{40}$/.test(entry.sourceRevision) ||
      typeof entry.sourceUrl !== "string" ||
      !entry.sourceUrl.startsWith("https://raw.githubusercontent.com/") ||
      !entry.sourceUrl.includes(`/${entry.sourceRevision}/`)
    )
      throw new Error("Invalid license override entry");
    if (seen.has(entry.name)) throw new Error(`Duplicate license override for ${entry.name}`);
    seen.add(entry.name);
    const item = exactPackage(entry);
    if (item.files.some((file) => !file.name.includes("/") && licenseName.test(file.name)))
      throw new Error(
        `License override for ${item.identity} is redundant; review the installed license`,
      );
    const text =
      readFileSync(join(directory, entry.file), "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";
    const hash = createHash("sha256")
      .update(readFileSync(join(directory, entry.file)))
      .digest("hex");
    if (hash !== entry.sha256)
      throw new Error(`License override hash mismatch for ${item.identity}`);
    item.files.push({
      name: `upstream ${entry.file}`,
      text,
      sourceUrl: entry.sourceUrl,
      sourceRevision: entry.sourceRevision,
      override: true,
    });
  }
  const fallbacks = manifest.metadataFallbacks ?? [];
  if (!Array.isArray(fallbacks)) throw new Error("Invalid metadata fallback manifest");
  if (!fallbacks.length) return;
  const canonical = manifest.canonicalTexts?.MIT;
  if (
    !canonical ||
    !/^[a-z0-9._-]+\.txt$/i.test(canonical.file) ||
    !/^[a-f0-9]{64}$/.test(canonical.sha256) ||
    !/^[a-f0-9]{40}$/.test(canonical.sourceRevision) ||
    canonical.sourceUrl !==
      `https://raw.githubusercontent.com/spdx/license-list-data/${canonical.sourceRevision}/text/MIT.txt`
  )
    throw new Error("Invalid pinned SPDX MIT text metadata");
  const standardBytes = readFileSync(join(directory, canonical.file));
  if (createHash("sha256").update(standardBytes).digest("hex") !== canonical.sha256)
    throw new Error("Pinned SPDX MIT text hash mismatch");
  const standardText = standardBytes.toString("utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";
  if (!standardText.includes("Copyright (c) <year> <copyright holders>"))
    throw new Error("Pinned SPDX MIT text is missing its unfilled copyright template");
  for (const entry of fallbacks) {
    if (
      !entry ||
      typeof entry.name !== "string" ||
      typeof entry.version !== "string" ||
      entry.license !== "MIT" ||
      typeof entry.repository !== "string" ||
      typeof entry.author !== "string" ||
      !/^[a-f0-9]{40}$/.test(entry.gitHead) ||
      entry.metadataUrl !== `https://registry.npmjs.org/${entry.name}/${entry.version}`
    )
      throw new Error("Invalid published metadata fallback entry");
    if (seen.has(entry.name)) throw new Error(`Duplicate license override for ${entry.name}`);
    seen.add(entry.name);
    const item = exactPackage(entry);
    const author = typeof item.author === "string" ? item.author.split(" <")[0] : item.author?.name;
    if (
      item.license !== entry.license ||
      item.repository !== entry.repository ||
      author !== entry.author
    )
      throw new Error(`Published license metadata changed for ${item.identity}`);
    if (
      item.files.some(
        (file) =>
          !file.name.includes("/") && (licenseName.test(file.name) || noticeName.test(file.name)),
      )
    )
      throw new Error(
        `Metadata fallback for ${item.identity} is redundant; review installed notices`,
      );
    item.metadataFallback = {
      ...entry,
      canonicalTextSha256: canonical.sha256,
      canonicalTextUrl: canonical.sourceUrl,
      canonicalTextRevision: canonical.sourceRevision,
    };
    item.files.push({
      name: "SPDX MIT standard terms (metadata fallback)",
      text: standardText,
      sourceUrl: canonical.sourceUrl,
      sourceRevision: canonical.sourceRevision,
      metadataFallback: true,
    });
  }
}

export function generateNotices({
  root = defaultRoot,
  output = join(root, "out", "third-party-notices.txt"),
  jsonOutput = join(root, "out", "third-party-notices.json"),
} = {}) {
  root = realpathSync(resolve(root));
  output = resolve(output);
  jsonOutput = resolve(jsonOutput);
  const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const renderer = rendererImports(root);
  const roots = new Set([...Object.keys(app.dependencies ?? {}), ...renderer, "electron"]);
  const queue = [...roots]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => ({ name, from: root, required: true }));
  const visited = new Set();
  const selected = new Map();
  const missingPackages = new Set();
  while (queue.length) {
    const { name, from, required } = queue.shift();
    const path = resolveInstalled(name, from, root);
    if (!path) {
      if (required) missingPackages.add(`${name} (required by ${relative(root, from) || "app"})`);
      continue;
    }
    if (visited.has(path)) continue;
    visited.add(path);
    const meta = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    const identity = `${meta.name}@${meta.version}`;
    const files = licenseFiles(path);
    const fingerprint = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    const prior = selected.get(identity);
    if (prior && prior.fingerprint !== fingerprint)
      throw new Error(`Conflicting installed license texts for ${identity}`);
    if (!prior)
      selected.set(identity, {
        identity,
        files,
        fingerprint,
        license: meta.license ?? null,
        repository: meta.repository ?? null,
        author: meta.author ?? null,
      });
    // The Electron npm package downloads the binary at install time. Its installer dependencies are not app code.
    if (name === "electron") continue;
    for (const dependency of Object.keys(meta.dependencies ?? {}).sort())
      queue.push({ name: dependency, from: path, required: true });
    for (const dependency of Object.keys(meta.optionalDependencies ?? {}).sort())
      queue.push({ name: dependency, from: path, required: false });
    for (const dependency of Object.keys(meta.peerDependencies ?? {}).sort()) {
      if (dependency === "typescript" || dependency.startsWith("@types/")) continue;
      if (!meta.peerDependenciesMeta?.[dependency]?.optional || roots.has(dependency)) {
        queue.push({
          name: dependency,
          from: path,
          required: !meta.peerDependenciesMeta?.[dependency]?.optional,
        });
      }
    }
  }
  const packages = [...selected.values()].sort((a, b) =>
    a.identity.localeCompare(b.identity, "en"),
  );
  applyOverrides(root, packages);
  const missingTexts = packages
    .filter(
      (item) =>
        !item.files.some(
          (file) =>
            file.override ||
            file.metadataFallback ||
            (!file.name.includes("/") && licenseName.test(file.name)),
        ),
    )
    .map((item) => item.identity);
  const lines = [
    "DayBoard third-party notices",
    "Generated offline from installed package files, pinned upstream text, and labeled metadata fallbacks.",
    "",
  ];
  for (const item of packages) {
    lines.push(`===== ${item.identity} (declared license: ${item.license ?? "unspecified"}) =====`);
    if (!item.files.length)
      lines.push("MISSING LICENSE TEXT: no local license or notice file was found.", "");
    for (const file of item.files) {
      lines.push(`--- ${file.name} ---`);
      if (file.metadataFallback) {
        lines.push(
          "No separate LICENSE or NOTICE file was provided in the installed package.",
          `Published package metadata: ${item.identity}; SPDX license declaration: ${item.license}; repository: ${item.metadataFallback.repository}.`,
          `Published author metadata: ${item.metadataFallback.author} (not a copyright attribution).`,
          `Published metadata source: ${item.metadataFallback.metadataUrl}; gitHead: ${item.metadataFallback.gitHead}.`,
          "The SPDX text below retains its <year> and <copyright holders> placeholders. No holder or year was inferred.",
        );
      }
      if (file.sourceUrl)
        lines.push(`Source: ${file.sourceUrl}`, `Revision: ${file.sourceRevision}`);
      lines.push(file.text.trimEnd(), "");
    }
  }
  if (missingPackages.size || missingTexts.length) {
    lines.push("===== INCOMPLETE NOTICE INVENTORY =====");
    for (const name of [...missingPackages].sort()) lines.push(`MISSING PACKAGE: ${name}`);
    for (const name of missingTexts) lines.push(`MISSING LICENSE TEXT: ${name}`);
    lines.push("");
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${lines.join("\n").trimEnd()}\n`);
  const json = {
    formatVersion: 1,
    packages: packages.map((item) => ({
      name: item.identity.slice(0, item.identity.lastIndexOf("@")),
      version: item.identity.slice(item.identity.lastIndexOf("@") + 1),
      declaredLicense: item.license,
      files: item.files.map((file) => ({
        name: file.name,
        sha256: createHash("sha256").update(file.text).digest("hex"),
        provenance: file.metadataFallback
          ? "spdx-metadata-fallback"
          : file.override
            ? "pinned-upstream-override"
            : "installed-package",
        sourceUrl: file.sourceUrl ?? null,
        sourceRevision: file.sourceRevision ?? null,
      })),
      metadataFallback: item.metadataFallback ?? null,
    })),
    missingPackages: [...missingPackages].sort(),
    missingTexts,
  };
  mkdirSync(dirname(jsonOutput), { recursive: true });
  writeFileSync(jsonOutput, `${JSON.stringify(json, null, 2)}\n`);
  return {
    output,
    jsonOutput,
    packages: packages.length,
    missingPackages: [...missingPackages].sort(),
    missingTexts,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  if (
    args.some(
      (arg) =>
        !["--root", "--output", "--json-output"].includes(arg) &&
        args[args.indexOf(arg) - 1] !== "--root" &&
        args[args.indexOf(arg) - 1] !== "--output" &&
        args[args.indexOf(arg) - 1] !== "--json-output",
    )
  ) {
    throw new Error(
      "Usage: node scripts/generate-notices.mjs [--root DIR] [--output FILE] [--json-output FILE]",
    );
  }
  const result = generateNotices({
    root: option("--root") ?? defaultRoot,
    output: option("--output"),
    jsonOutput: option("--json-output"),
  });
  console.log(`${result.packages} packages inventoried in ${result.output}`);
  if (result.missingPackages.length || result.missingTexts.length) {
    console.error(
      `Notice inventory incomplete: ${result.missingPackages.length} missing packages, ${result.missingTexts.length} missing license texts.`,
    );
    for (const name of result.missingPackages) console.error(`Missing package: ${name}`);
    for (const name of result.missingTexts) console.error(`Missing license text: ${name}`);
    process.exitCode = 1;
  }
}
