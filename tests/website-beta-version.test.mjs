import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../website/${name}`, import.meta.url), "utf8");

// Each pattern marks copy that names the current beta, not a historical one such as a screenshot
// caption. All of them must name the beta whose DMG download.html links.
const currentBetaCopy = {
  "index.html": [
    /Beta (\d+) · Limited access/g,
    /Explore the beta (\d+) guide/g,
    /What's available in beta (\d+)/g,
  ],
  "docs.html": [/Get started with DayBoard beta (\d+)/g, /make beta (\d+) work the way you do/g],
};

test("the homepage and guide name the beta the download page links", async () => {
  const download = await read("download.html");
  const linked = new Set(
    [...download.matchAll(/releases\/download\/v\d+\.\d+\.\d+-beta\.(\d+)\//g)].map((m) => m[1]),
  );
  assert.equal(linked.size, 1, "download.html links exactly one beta");
  const [beta] = linked;

  for (const [page, patterns] of Object.entries(currentBetaCopy)) {
    const html = await read(page);
    for (const pattern of patterns) {
      const found = [...html.matchAll(pattern)].map((m) => m[1]);
      assert.deepEqual(found, [beta], `${page} ${pattern} names beta ${beta}`);
    }
  }
});
