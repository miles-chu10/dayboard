/** Relative luminance (WCAG) of a `#rrggbb` hex color, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const int = Number.parseInt(full, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const linear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Returns `#000000` or `#ffffff`, whichever gives the higher-contrast text on `accentHex`. */
export function computeAccentContrastColor(accentHex: string): string {
  return relativeLuminance(accentHex) > 0.45 ? "#000000" : "#ffffff";
}
