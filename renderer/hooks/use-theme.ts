import { useEffect, useState } from "react";
import type { NativeThemeInfo } from "@shared/bridge-protocol";

/** Native preferences are optional so portable/older bridges retain an opaque, accessible shell. */
export function useTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const transparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast = window.matchMedia("(prefers-contrast: more)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let info: NativeThemeInfo | undefined;
    let cancelled = false;
    let request = 0;
    function syncAccessibility() {
      const root = document.documentElement;
      root.classList.toggle(
        "reduce-transparency",
        transparency.matches || Boolean(info?.prefersReducedTransparency),
      );
      root.classList.toggle(
        "increase-contrast",
        contrast.matches || Boolean(info?.shouldUseHighContrastColors),
      );
      root.classList.toggle("reduce-motion", motion.matches || Boolean(info?.prefersReducedMotion));
      root.classList.toggle(
        "differentiate-without-color",
        Boolean(info?.shouldDifferentiateWithoutColor),
      );
      root.classList.toggle("window-inactive", !document.hasFocus());
    }
    function syncMedia() {
      setIsDark(scheme.matches);
      syncAccessibility();
    }
    async function refreshNative() {
      const current = ++request;
      try {
        const result = await window.dayboard?.nativeTheme?.getInfo();
        if (cancelled || current !== request || !result) return;
        info = result;
        setIsDark(result.shouldUseDarkColors);
        syncAccessibility();
      } catch {
        // No native bridge: opaque chrome and the media-query preferences remain available.
      }
    }
    function focus() {
      syncAccessibility();
      void refreshNative();
    }
    syncMedia();
    void refreshNative();
    const media = [scheme, transparency, contrast, motion];
    for (const query of media) query.addEventListener("change", syncMedia);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", syncAccessibility);
    const unsubscribe = window.dayboard?.ipc?.onNotification(
      "nativeTheme:updated",
      () => void refreshNative(),
    );
    return () => {
      cancelled = true;
      for (const query of media) query.removeEventListener("change", syncMedia);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", syncAccessibility);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);
  return isDark;
}
export default useTheme;
