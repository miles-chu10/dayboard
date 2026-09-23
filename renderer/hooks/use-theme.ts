import { useEffect, useState } from "react";

/**
 * Syncs `<html>`'s `.dark` class with the OS appearance (or the user's explicit override, applied
 * via `window.dayboard.nativeTheme.setThemeSource` elsewhere) and returns whether dark mode is
 * currently active. Electron mirrors `nativeTheme.themeSource` into the OS-level
 * `prefers-color-scheme` media query for every window, so a plain `matchMedia` listener stays in
 * sync with both system changes and in-app theme-source changes without a dedicated IPC broadcast.
 */
export function useTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setIsDark(media.matches);
    sync();
    media.addEventListener("change", sync);

    let cancelled = false;
    window.dayboard?.nativeTheme
      .getInfo()
      .then((info) => {
        if (!cancelled) setIsDark(info.shouldUseDarkColors);
      })
      .catch(() => {
        /* Bridge unavailable (e.g. tests); fall back to the media query above. */
      });

    return () => {
      cancelled = true;
      media.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);

  return isDark;
}

export default useTheme;
