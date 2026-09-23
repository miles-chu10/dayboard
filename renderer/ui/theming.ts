/**
 * WCAG contrast helpers. The runtime accent (appearance.ts) and the static defaults in theme.css
 * both come from `accentColors`, and theming.test.ts checks theme.css against these rules.
 */

export type Scheme = "light" | "dark";

/** Text needs 4.5:1 (WCAG 1.4.3); icons, dots, rings and control borders need 3:1 (1.4.11). */
export const TEXT_CONTRAST = 4.5;
export const MARK_CONTRAST = 3;

/** Surfaces text sits on, mirroring theme.css (theming.test.ts keeps the two in sync). */
export const SURFACES: Record<
  Scheme,
  {
    background: string;
    backgroundSecondary: string;
    well: string;
    control: string;
    controlSubtle: string;
    listHover: string;
    listSelection: string;
  }
> = {
  light: {
    background: "#ffffff",
    backgroundSecondary: "#f5f5f7",
    well: "#f5f5f6",
    control: "rgb(0 0 0 / 6%)",
    controlSubtle: "rgb(0 0 0 / 4%)",
    listHover: "rgb(0 0 0 / 5%)",
    listSelection: "rgb(0 0 0 / 8%)",
  },
  dark: {
    background: "#1e1e1e",
    backgroundSecondary: "#262626",
    well: "#2c2c2e",
    control: "rgb(255 255 255 / 9%)",
    controlSubtle: "rgb(255 255 255 / 6%)",
    listHover: "rgb(255 255 255 / 7%)",
    listSelection: "rgb(255 255 255 / 13%)",
  },
};

type Rgb = [number, number, number];

/** Parses `#rgb`, `#rrggbb`, or `rgb(r g b / a%)` into 0–255 channels and 0–1 alpha. */
export function parseColor(css: string): { rgb: Rgb; alpha: number } {
  const value = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const int = Number.parseInt(full, 16);
    return { rgb: [(int >> 16) & 255, (int >> 8) & 255, int & 255], alpha: 1 };
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/i.exec(value);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha };
  }
  throw new Error(`Unsupported color: ${css}`);
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Flattens a possibly translucent color onto an opaque one; returns `#rrggbb`. */
export function composite(color: string, ground: string): string {
  const top = parseColor(color);
  const base = parseColor(ground).rgb;
  return toHex(base.map((c, i) => top.rgb[i] * top.alpha + c * (1 - top.alpha)) as Rgb);
}

function relativeLuminance(color: string): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseColor(color).rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `color` toward `target` by `amount` (0–1) in sRGB, like `color-mix(in srgb, …)`. */
function mix(color: string, target: string, amount: number): string {
  const from = parseColor(color).rgb;
  const to = parseColor(target).rgb;
  return toHex(from.map((c, i) => c + (to[i] - c) * amount) as Rgb);
}

/**
 * The closest color to `color` (same hue, darker for light schemes, lighter for dark) that
 * reaches `min` contrast on every ground. Returns `color` itself when it already does.
 */
export function ensureContrast(
  color: string,
  grounds: string[],
  min: number,
  scheme: Scheme,
): string {
  const target = scheme === "light" ? "#000000" : "#ffffff";
  for (let step = 0; step <= 200; step++) {
    const candidate = mix(color, target, step / 200);
    if (grounds.every((ground) => contrastRatio(candidate, ground) >= min)) return candidate;
  }
  return target;
}

/** Opaque grounds that text and marks appear on in a scheme: page, sidebar, wells, rows, chips. */
export function textGrounds(scheme: Scheme): string[] {
  const s = SURFACES[scheme];
  return [
    s.background,
    s.backgroundSecondary,
    s.well,
    composite(s.listHover, s.well),
    composite(s.listSelection, s.well),
    composite(s.listHover, s.backgroundSecondary),
    composite(s.listSelection, s.backgroundSecondary),
    composite(s.controlSubtle, s.well),
    composite(s.controlSubtle, s.background),
    composite(s.control, s.well),
  ];
}

/** Grounds plus `color`'s own tint (a 10–12% wash under Badge, Callout and DueChip text). */
export function tintedGrounds(color: string, scheme: Scheme, washPercent: number): string[] {
  const s = SURFACES[scheme];
  const { rgb } = parseColor(color);
  const wash = `rgb(${rgb.join(" ")} / ${washPercent}%)`;
  return [...textGrounds(scheme), composite(wash, s.background), composite(wash, s.well)];
}

/** White when white can reach 4.5:1 with a small darkening; black for clearly light colors. */
function prefersBlackText(color: string): boolean {
  return contrastRatio(color, "#000000") >= 7;
}

/**
 * Everything the app derives from an accent color for one scheme:
 * - `fill`: the accent behind text (buttons, checked boxes, today's date), darkened just enough
 *   for white text when white is used;
 * - `contrast`: text and icons on `fill`;
 * - `ink`: accent-colored text, focus rings and strokes, adjusted to 4.5:1 on every ground.
 */
export function accentColors(
  accent: string,
  scheme: Scheme,
): { fill: string; contrast: string; ink: string } {
  const hex = composite(accent, SURFACES[scheme].background);
  const contrast = prefersBlackText(hex) ? "#000000" : "#ffffff";
  const fill =
    contrast === "#ffffff" ? ensureContrast(hex, ["#ffffff"], TEXT_CONTRAST, "light") : hex;
  const ink = ensureContrast(hex, tintedGrounds(hex, scheme, 10), TEXT_CONTRAST, scheme);
  return { fill, contrast, ink };
}
