import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { generateNotices } from "../scripts/generate-notices.mjs";

const script = resolve("scripts/generate-notices.mjs");

function fixture(t, dependencies = { server: "1" }) {
  const root = mkdtempSync(join(tmpdir(), "dayboard-notices-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies }));
  mkdirSync(join(root, "renderer"));
  return root;
}

function pkg(
  root,
  name,
  version,
  {
    dependencies,
    optionalDependencies,
    peerDependencies,
    peerDependenciesMeta,
    licenseText = `${name} ${version} license`,
    noticeText,
  } = {},
  under = root,
) {
  const dir = join(under, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version,
      license: "MIT",
      dependencies,
      optionalDependencies,
      peerDependencies,
      peerDependenciesMeta,
    }),
  );
  if (licenseText !== null) writeFileSync(join(dir, "LICENSE.md"), licenseText);
  if (noticeText) writeFileSync(join(dir, "NOTICE"), noticeText);
  return dir;
}

test("walks nested runtime versions, renderer and CSS roots, peers, and notices", (t) => {
  const root = fixture(t);
  const server = pkg(root, "server", "1.0.0", {
    dependencies: { shared: "1", nested: "1" },
    optionalDependencies: { absent: "1" },
  });
  pkg(root, "shared", "1.0.0", { noticeText: "shared notice" });
  const nested = pkg(root, "nested", "1.0.0", { dependencies: { shared: "2" } }, server);
  pkg(root, "shared", "2.0.0", {}, nested);
  pkg(root, "electron", "44.0.0", { dependencies: { "installer-only": "1" } });
  pkg(root, "react", "19.0.0");
  pkg(root, "renderer-lib", "3.0.0", { peerDependencies: { react: "*", "@types/react": "*" } });
  pkg(root, "css-lib", "4.0.0");
  writeFileSync(
    join(root, "renderer", "view.tsx"),
    'import { x } from "renderer-lib/subpath";\nimport "@renderer/ui";\n',
  );
  writeFileSync(join(root, "renderer", "style.css"), '@import "css-lib/theme.css";\n');
  const output = join(root, "out", "third-party-notices.txt");
  const result = generateNotices({ root, output });
  assert.deepEqual(result.missingPackages, []);
  assert.deepEqual(result.missingTexts, []);
  const text = readFileSync(output, "utf8");
  for (const name of [
    "server@1.0.0",
    "shared@1.0.0",
    "shared@2.0.0",
    "renderer-lib@3.0.0",
    "css-lib@4.0.0",
    "react@19.0.0",
    "electron@44.0.0",
  ])
    assert.match(text, new RegExp(name.replaceAll(".", "\\.")));
  assert.equal((text.match(/===== shared@1\.0\.0 /g) ?? []).length, 1);
  assert.match(text, /shared notice/);
  assert.doesNotMatch(text, /installer-only|@types\/react|absent/);
  const first = readFileSync(output);
  const firstJson = readFileSync(join(root, "out", "third-party-notices.json"));
  generateNotices({ root, output });
  assert.deepEqual(readFileSync(output), first);
  assert.deepEqual(readFileSync(join(root, "out", "third-party-notices.json")), firstJson);
  execFileSync(process.execPath, [script, "--root", root, "--output", output]);
  assert.deepEqual(readFileSync(output), first);
  assert.deepEqual(readFileSync(join(root, "out", "third-party-notices.json")), firstJson);
});

test("reports missing package and license text, retains an auditable partial output, and exits nonzero", (t) => {
  const root = fixture(t, { missing: "1", bare: "1" });
  const bare = pkg(root, "bare", "1.0.0", { licenseText: null, noticeText: "copyright notice" });
  mkdirSync(join(bare, "vendor"));
  writeFileSync(join(bare, "vendor", "LICENSE"), "embedded dependency license");
  writeFileSync(
    join(bare, "vendored.ts"),
    "// Licensed under BSD-3-Clause\n// Copyright 2026 Upstream\n// Redistribution and use permitted.\n\nexport const x = 1;\n",
  );
  pkg(root, "electron", "44.0.0");
  const output = join(root, "out", "third-party-notices.txt");
  const result = generateNotices({ root, output });
  assert.deepEqual(result.missingTexts, ["bare@1.0.0"]);
  assert.equal(result.missingPackages.length, 1);
  assert.match(result.missingPackages[0], /^missing \(required by app\)$/);
  const text = readFileSync(output, "utf8");
  assert.match(text, /copyright notice/);
  assert.match(text, /vendor\/LICENSE[\s\S]*embedded dependency license/);
  assert.match(text, /vendored\.ts \(license header\)[\s\S]*Copyright 2026 Upstream/);
  assert.match(text, /MISSING LICENSE TEXT: bare@1\.0\.0/);
  assert.match(text, /MISSING PACKAGE: missing/);
  const run = spawnSync(process.execPath, [script, "--root", root, "--output", output], {
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Missing license text: bare@1\.0\.0/);
});

test("uses a pinned upstream override only for the exact installed version and content", (t) => {
  const root = fixture(t, { bare: "1" });
  const bare = pkg(root, "bare", "1.0.0", { licenseText: null });
  pkg(root, "electron", "44.0.0");
  const directory = join(root, "licenses", "overrides");
  mkdirSync(directory, { recursive: true });
  const text = "Copyright 2026 Example. Actual upstream license text.\n";
  const file = "bare-1.0.0.LICENSE";
  writeFileSync(join(directory, file), text);
  const manifest = {
    entries: [
      {
        name: "bare",
        version: "1.0.0",
        file,
        sha256: createHash("sha256").update(text).digest("hex"),
        sourceRevision: "a".repeat(40),
        sourceUrl: `https://raw.githubusercontent.com/example/bare/${"a".repeat(40)}/LICENSE`,
      },
    ],
  };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  const output = join(root, "out", "third-party-notices.txt");
  assert.deepEqual(generateNotices({ root, output }).missingTexts, []);
  assert.match(
    readFileSync(output, "utf8"),
    /Source: https:\/\/raw\.githubusercontent\.com\/example\/bare/,
  );
  writeFileSync(join(directory, file), `${text}tampered`);
  assert.throws(() => generateNotices({ root, output }), /hash mismatch/);
  writeFileSync(join(directory, file), text);
  writeFileSync(
    join(bare, "package.json"),
    JSON.stringify({ name: "bare", version: "1.0.1", license: "MIT" }),
  );
  assert.throws(() => generateNotices({ root, output }), /does not match the installed version/);
});

test("labels a published MIT metadata fallback and rejects changed version, declaration, or standard text", (t) => {
  const root = fixture(t, { bare: "1" });
  const bare = pkg(root, "bare", "1.0.0", { licenseText: null });
  pkg(root, "electron", "44.0.0");
  const metadata = {
    name: "bare",
    version: "1.0.0",
    license: "MIT",
    repository: "example/bare",
    author: "Example Author",
  };
  writeFileSync(join(bare, "package.json"), JSON.stringify(metadata));
  const directory = join(root, "licenses", "overrides");
  mkdirSync(directory, { recursive: true });
  const standard = readFileSync(resolve("licenses/overrides/SPDX-MIT.txt"));
  writeFileSync(join(directory, "SPDX-MIT.txt"), standard);
  const revision = "b".repeat(40);
  const manifest = {
    entries: [],
    canonicalTexts: {
      MIT: {
        file: "SPDX-MIT.txt",
        sha256: createHash("sha256").update(standard).digest("hex"),
        sourceRevision: revision,
        sourceUrl: `https://raw.githubusercontent.com/spdx/license-list-data/${revision}/text/MIT.txt`,
      },
    },
    metadataFallbacks: [
      {
        ...metadata,
        gitHead: "c".repeat(40),
        metadataUrl: "https://registry.npmjs.org/bare/1.0.0",
      },
    ],
  };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  const output = join(root, "out", "third-party-notices.txt");
  assert.deepEqual(generateNotices({ root, output }).missingTexts, []);
  const notices = readFileSync(output, "utf8");
  assert.match(notices, /No separate LICENSE or NOTICE file was provided/);
  assert.match(
    notices,
    /Published author metadata: Example Author \(not a copyright attribution\)/,
  );
  assert.match(notices, /Copyright \(c\) <year> <copyright holders>/);
  const inventory = JSON.parse(readFileSync(join(root, "out", "third-party-notices.json"), "utf8"));
  const record = inventory.packages.find((item) => item.name === "bare");
  assert.equal(record.metadataFallback.canonicalTextSha256, manifest.canonicalTexts.MIT.sha256);
  assert.equal(record.files.at(-1).provenance, "spdx-metadata-fallback");
  writeFileSync(
    join(bare, "package.json"),
    JSON.stringify({ ...metadata, license: "MIT OR Apache-2.0" }),
  );
  assert.throws(() => generateNotices({ root, output }), /metadata changed/);
  writeFileSync(join(bare, "package.json"), JSON.stringify({ ...metadata, version: "1.0.1" }));
  assert.throws(() => generateNotices({ root, output }), /does not match the installed version/);
  writeFileSync(join(bare, "package.json"), JSON.stringify(metadata));
  writeFileSync(join(directory, "SPDX-MIT.txt"), `${standard}changed`);
  assert.throws(() => generateNotices({ root, output }), /text hash mismatch/);
});
