import { useEffect } from "react";
import { computeAccentContrastColor } from "@glaze/core/components";
import type { AccentColor } from "@main/shared-types";

import { useSettings } from "./settings";

export const ACCENT_OPTIONS: { value: AccentColor; label: string; light: string; dark: string }[] =
  [
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

// Unnamespaced so the accent applies before first paint, including in demo mode.
const CACHE_KEY = "dayboard:accent";
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
    const rule = (hex: string) =>
      `--theme-accent: ${hex} !important; --accent: ${hex} !important; --accent-contrast: ${computeAccentContrastColor(hex)} !important;`;
    style.textContent = `:root:root { ${rule(option.light)} } :root.dark:root { ${rule(option.dark)} }`;
  }
  localStorage.setItem(CACHE_KEY, accent);
}

export function applyCachedAccent(): void {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached && ACCENT_OPTIONS.some((item) => item.value === cached))
    applyAccent(cached as AccentColor);
}

/** Keeps this window's accent in step with Settings. */
export function useAccentSync(): void {
  const accent = useSettings().data?.general.accent;
  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);
}
