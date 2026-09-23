import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MARK_CONTRAST,
  SURFACES,
  TEXT_CONTRAST,
  accentColors,
  composite,
  contrastRatio,
  markGrounds,
  textGrounds,
  tintedGrounds,
  type Scheme,
} from "./theming";

const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const appearance = readFileSync(new URL("../lib/appearance.ts", import.meta.url), "utf8");

const SUPPORT = ["red", "orange", "yellow", "green", "blue", "purple", "magenta"];

function vars(selector: string): Record<string, string> {
  const start = theme.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `theme.css has no ${selector} block`);
  const body = theme.slice(start, theme.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
}

const SCHEMES: Record<Scheme, Record<string, string>> = {
  light: vars(":root"),
  dark: vars(":root.dark"),
};

function minContrast(color: string, grounds: string[]): number {
  return Math.min(...grounds.map((ground) => contrastRatio(composite(color, ground), ground)));
}

test("the OS-dark fallback block matches :root.dark", () => {
  assert.deepEqual(vars(":root:not(.light)"), SCHEMES.dark);
});

test("theming.ts surfaces match theme.css", () => {
  for (const scheme of ["light", "dark"] as Scheme[]) {
    const v = SCHEMES[scheme];
    const s = SURFACES[scheme];
    assert.equal(v["--db-background"], s.background);
    assert.equal(v["--db-background-secondary"], s.backgroundSecondary);
    assert.equal(v["--db-well"], s.well);
    assert.equal(v["--db-control"], s.control);
    assert.equal(v["--db-control-subtle"], s.controlSubtle);
    assert.equal(v["--db-list-hover"], s.listHover);
    assert.equal(v["--db-list-selection"], s.listSelection);
  }
});

for (const scheme of ["light", "dark"] as Scheme[]) {
  const v = SCHEMES[scheme];
  const grounds = textGrounds(scheme);
  const s = SURFACES[scheme];

  test(`${scheme}: text colors reach 4.5:1 on every surface`, () => {
    for (const name of ["primary", "secondary", "tertiary", "link"]) {
      const ratio = minContrast(v[`--db-${name}`], grounds);
      assert.ok(ratio >= TEXT_CONTRAST, `${name} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${scheme}: support inks reach 4.5:1, including on their own tint`, () => {
    for (const color of SUPPORT) {
      const ink = v[`--db-support-${color}-ink`];
      const ratio = minContrast(ink, tintedGrounds(v[`--db-support-${color}`], scheme, 12));
      assert.ok(ratio >= TEXT_CONTRAST, `support-${color}-ink is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${scheme}: support fills and field borders reach 3:1 as marks`, () => {
    const marks = [s.background, s.backgroundSecondary, s.well];
    for (const color of SUPPORT) {
      const ratio = minContrast(v[`--db-support-${color}`], marks);
      assert.ok(ratio >= MARK_CONTRAST, `support-${color} is ${ratio.toFixed(2)}:1`);
    }
    const field = minContrast(v["--db-field"], marks);
    assert.ok(field >= MARK_CONTRAST, `field is ${field.toFixed(2)}:1`);
  });

  test(`${scheme}: white text reaches 4.5:1 on destructive buttons`, () => {
    assert.ok(contrastRatio("#ffffff", v["--db-destructive"]) >= TEXT_CONTRAST);
  });

  test(`${scheme}: the default accent's derived colors match accentColors`, () => {
    const { fill, contrast, ink } = accentColors(v["--accent"], scheme);
    assert.equal(v["--accent-fill"], fill);
    assert.equal(v["--accent-contrast"], contrast);
    assert.equal(v["--accent-ink"], ink);
  });
}

test("every accent option gets readable button text, visible fills and accent text in both schemes", () => {
  const options = [
    ...appearance.matchAll(/light: "(#[0-9A-Fa-f]{6})", dark: "(#[0-9A-Fa-f]{6})"/g),
  ];
  assert.ok(options.length >= 9, "expected the ACCENT_OPTIONS hex pairs in appearance.ts");
  for (const [, light, dark] of options) {
    for (const [scheme, hex] of [
      ["light", light],
      ["dark", dark],
    ] as [Scheme, string][]) {
      const { fill, contrast, ink } = accentColors(hex, scheme);
      const onFill = contrastRatio(contrast, fill);
      assert.ok(onFill >= TEXT_CONTRAST, `${hex} (${scheme}) button text ${onFill.toFixed(2)}:1`);
      const asMark = Math.min(...markGrounds(scheme).map((ground) => contrastRatio(fill, ground)));
      assert.ok(
        asMark >= MARK_CONTRAST,
        `${hex} (${scheme}) fill as a mark ${asMark.toFixed(2)}:1`,
      );
      const asText = minContrast(ink, tintedGrounds(hex, scheme, 10));
      assert.ok(asText >= TEXT_CONTRAST, `${hex} (${scheme}) accent text ${asText.toFixed(2)}:1`);
    }
  }
});

test("text, stroke and accent utilities are wired to the contrast-safe colors", () => {
  for (const color of SUPPORT) {
    assert.match(
      theme,
      new RegExp(`--text-color-support-${color}: var\\(--db-support-${color}-ink\\);`),
    );
    assert.match(
      theme,
      new RegExp(`--stroke-support-${color}: var\\(--db-support-${color}-ink\\);`),
    );
  }
  for (const [key, value] of [
    ["--background-color-accent", "--accent-fill"],
    ["--border-color-accent", "--accent-fill"],
    ["--text-color-accent", "--accent-ink"],
    ["--outline-color-accent", "--accent-ink"],
    ["--ring-color-accent", "--accent-ink"],
    ["--stroke-accent", "--accent-ink"],
    ["--color-destructive", "--db-destructive"],
  ]) {
    assert.match(theme, new RegExp(`${key}: var\\(${value}\\);`));
  }
});
