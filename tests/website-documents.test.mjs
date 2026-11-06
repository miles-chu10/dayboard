import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../website/", import.meta.url);
const names = (await readdir(root)).filter((name) => name.endsWith(".html"));
const pages = new Map(
  await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, root), "utf8")])),
);
const ids = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

test("public pages keep unique anchors and working local asset and document links", async () => {
  for (const [name, html] of pages) {
    const identifiers = ids(html);
    assert.equal(new Set(identifiers).size, identifiers.length, `${name}: duplicate IDs`);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1, `${name}: one main heading`);
    assert.ok(identifiers.includes("main"), `${name}: skip-link destination`);

    for (const [, value] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//")) continue;
      const url = new URL(value, `https://getdayboard.com/${name}`);
      let path = decodeURIComponent(url.pathname.slice(1)) || "index.html";
      if (!path.split("/").at(-1).includes(".")) path += ".html";
      assert.ok((await stat(new URL(path, root))).isFile(), `${name}: ${value} exists`);
      if (url.hash && pages.has(path)) {
        assert.ok(
          ids(pages.get(path)).includes(decodeURIComponent(url.hash.slice(1))),
          `${name}: ${value} anchor exists`,
        );
      }
    }
  }
});

test("page bootstrap scripts remain allowed by the deployed content security policy", async () => {
  const headers = await readFile(new URL("_headers", root), "utf8");
  for (const [name, html] of pages) {
    for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const hash = createHash("sha256").update(script).digest("base64");
      assert.ok(headers.includes(`'sha256-${hash}'`), `${name}: inline bootstrap matches CSP`);
    }
  }
});

test("documentation and policy links retain their public deep-link destinations", () => {
  const expected = {
    "index.html": ["demo", "join", "how", "features", "privacy", "pricing", "roadmap", "faq"],
    "docs.html": [
      "home",
      "agenda",
      "sources",
      "views",
      "mail",
      "ai",
      "notes",
      "panels",
      "shortcuts",
      "mcp",
      "data",
      "updates",
    ],
    "privacy.html": ["google", "website", "purchases", "contact"],
    "pricing.html": ["buy"],
    "beta.html": ["install", "join"],
    "waitlist.html": ["join"],
  };
  for (const [name, anchors] of Object.entries(expected)) {
    for (const anchor of anchors)
      assert.ok(ids(pages.get(name)).includes(anchor), `${name}#${anchor}`);
  }
});

test("the not-found page uses root-relative local resources at nested URLs", () => {
  for (const [, value] of pages.get("404.html").matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("#")) continue;
    assert.ok(value.startsWith("/"), `${fileURLToPath(new URL("404.html", root))}: ${value}`);
  }
});
