import { useEffect } from "react";
import { accentColors, type Scheme } from "@renderer/ui";
import type { AccentColor, Density } from "@main/shared-types";

import { useSettings } from "./settings";
import { storedKey } from "./storage";

export const ACCENT_OPTIONS: {
  value: AccentColor;
  label: string;
  light: string;
  dark: string;
}[] = [
  { value: "system", label: "System", light: "", dark: "" },
  { value: "blue", label: "Blue", light: "#007AFF", dark: "#0A84FF" },
  { value: "purple", label: "Purple", light: "#9A44D6", dark: "#BF5AF2" },
  { value: "pink", label: "Pink", light: "#E6336F", dark: "#FF4F86" },
  { value: "red", label: "Red", light: "#E0352B", dark: "#FF453A" },
  { value: "orange", label: "Orange", light: "#EE7A00", dark: "#FF9F0A" },
  { value: "yellow", label: "Yellow", light: "#E0A800", dark: "#FFD60A" },
  { value: "green", label: "Green", light: "#1F9D45", dark: "#30D158" },
  { value: "teal", label: "Teal", light: "#0A9CB0", dark: "#40C8E0" },
  { value: "graphite", label: "Graphite", light: "#7C7C82", dark: "#98989D" },
];

const CACHE_KEY = "dayboard:accent";
const DENSITY_KEY = "dayboard:density";
const STYLE_ID = "dayboard-accent";

/** Overrides the accent (and the macOS system accent) for this window; "system" restores it. */
export function applyAccent(accent: AccentColor): void {
  const option = ACCENT_OPTIONS.find((item) => item.value === accent);
  let style = document.getElementById(STYLE_ID);
  if (!option || option.value === "system") {
    style?.remove();
  } else {
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    const rule = (hex: string, scheme: Scheme) => {
      const { fill, fillHover, fillActive, contrast, ink } = accentColors(hex, scheme);
      return `--theme-accent: ${hex} !important; --accent: ${hex} !important; --accent-fill: ${fill} !important; --accent-fill-hover: ${fillHover} !important; --accent-fill-active: ${fillActive} !important; --accent-contrast: ${contrast} !important; --accent-ink: ${ink} !important;`;
    };
    style.textContent = `:root:root { ${rule(option.light, "light")} } :root.dark:root { ${rule(option.dark, "dark")} }`;
  }
  localStorage.setItem(storedKey(CACHE_KEY), accent);
}

/** Compact mode swaps the `--density-*` spacing variables defined in styles.css. */
export function applyDensity(density: Density): void {
  document.documentElement.classList.toggle("density-compact", density === "compact");
  localStorage.setItem(storedKey(DENSITY_KEY), density);
}

/** Applies the last-known accent and density before first paint. */
export function applyCachedAppearance(): void {
  const cached = localStorage.getItem(storedKey(CACHE_KEY));
  if (cached && ACCENT_OPTIONS.some((item) => item.value === cached))
    applyAccent(cached as AccentColor);
  if (localStorage.getItem(storedKey(DENSITY_KEY)) === "compact") applyDensity("compact");
}

/** Keeps this window's accent and density in step with Settings. */
export function useAppearanceSync(): void {
  const general = useSettings().data?.general;
  const accent = general?.accent;
  const density = general?.density;
  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);
  useEffect(() => {
    if (density) applyDensity(density);
  }, [density]);
}
