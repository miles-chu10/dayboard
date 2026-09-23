import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SourceColor } from "@main/shared-types";

import { sourceColorVar } from "./source-colors";

// A Record so type-checking fails here when a SourceColor is added.
const COLORS: Record<SourceColor, true> = {
  blue: true,
  green: true,
  orange: true,
  red: true,
  purple: true,
  magenta: true,
  yellow: true,
};

const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = theme.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `theme.css has no ${selector} block`);
  return theme.slice(start, theme.indexOf("}", start));
}

test("every source color resolves to a variable theme.css declares in light and dark", () => {
  const light = block(":root");
  const dark = block(":root.dark");
  for (const color of Object.keys(COLORS) as SourceColor[]) {
    const name = /^var\((--[a-z-]+)\)$/.exec(sourceColorVar(color))?.[1];
    assert.ok(name, `sourceColorVar("${color}") is not a plain var()`);
    assert.match(light, new RegExp(`${name}:`), `${name} missing from :root`);
    assert.match(dark, new RegExp(`${name}:`), `${name} missing from :root.dark`);
  }
});
