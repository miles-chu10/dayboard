import { useEffect, useEffectEvent, useRef } from "react";

import { invoke } from "../lib/ipc";

export type PanelSurface = "capture" | "menubar";

export function panelSurface(): PanelSurface | null {
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "capture" || hash === "menubar" ? hash : null;
}

export function hidePanel(surface: PanelSurface): Promise<void> {
  return invoke("panel:hide", { surface });
}

export function showPanel(surface: PanelSurface): Promise<void> {
  return invoke("panel:show", { surface });
}

/** Keeps the panel window as tall as its content. */
export function useFitPanelHeight<T extends HTMLElement>(surface: PanelSurface) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      void invoke("panel:resize", { surface, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [surface]);
  return ref;
}

/** Runs `onShown` each time the panel window gains focus (the main process focuses it on show). */
export function usePanelShown(onShown: () => void) {
  const handler = useEffectEvent(onShown);
  useEffect(() => {
    const listener = () => handler();
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, []);
}

/** Esc hides the panel wherever focus is, including right after it opens with nothing focused. */
export function usePanelEscape(surface: PanelSurface) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      // An Escape during IME composition cancels the composition, not the panel.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void hidePanel(surface);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [surface]);
}
