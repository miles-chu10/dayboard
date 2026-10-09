import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@renderer/ui";
import { ResizeHandle } from "@renderer/ui/split-view";
import { clamp, INSPECTOR_SIZE, inspectorWidth } from "../lib/shell";

/** One portal container survives responsive placement; React never remounts a detail editor. */
export function DetailsLayout({
  children,
  details,
  selectedKey,
  storageKey,
  label,
  inlineMode = "row",
}: {
  children: ReactNode;
  details: ReactNode;
  selectedKey?: string;
  storageKey: string;
  label: string;
  inlineMode?: "row" | "stack";
}) {
  const root = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasCollapsed = useRef(false);
  const [container] = useState(() => document.createElement("div"));
  const id = useId();
  const key = `dayboard:split-view:${storageKey}:inspector`;
  const collapsedKey = `dayboard:split-view:${storageKey}:inspector-collapsed`;
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(key));
    return clamp(
      stored > 0 ? stored : INSPECTOR_SIZE.default,
      INSPECTOR_SIZE.min,
      INSPECTOR_SIZE.max,
    );
  });
  const [hiddenSelection, setHiddenSelection] = useState(() => ({
    hidden: localStorage.getItem(collapsedKey) === "1",
    key: selectedKey,
  }));
  const collapsed = hiddenSelection.hidden && hiddenSelection.key === selectedKey;
  const [available, setAvailable] = useState(0);
  const fitted = inspectorWidth(available, width);
  const active = Boolean(details);
  const isSide = fitted !== null;
  const stacked = active && !isSide && !collapsed && inlineMode === "stack";
  const controls = document.querySelector("[data-inspector-controls]");

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const selected = selectedKey
      ? primary.current?.querySelector(`[data-detail-anchor="${CSS.escape(selectedKey)}"]`)
      : null;
    const target =
      isSide || inlineMode === "stack"
        ? side.current
        : (selected ?? primary.current?.querySelector("[data-inline-details]"));
    if (!target || container.parentElement === target) return;
    const focus =
      document.activeElement instanceof HTMLElement && container.contains(document.activeElement)
        ? document.activeElement
        : null;
    target.appendChild(container);
    focus?.focus({ preventScroll: true });
  });
  useEffect(() => () => container.remove(), [container]);

  useEffect(() => {
    localStorage.setItem(collapsedKey, collapsed ? "1" : "0");
  }, [collapsed, collapsedKey]);
  useLayoutEffect(() => {
    if (wasCollapsed.current && !collapsed && returnFocus.current?.isConnected) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
    wasCollapsed.current = collapsed;
  }, [collapsed]);

  const toggle = useCallback(() => {
    const next = !collapsed;
    if (next) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement && container.contains(document.activeElement)
          ? document.activeElement
          : null;
      if (returnFocus.current) toggleRef.current?.focus({ preventScroll: true });
    }
    setHiddenSelection({ hidden: next, key: selectedKey });
  }, [collapsed, container, selectedKey]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        !active ||
        event.key.toLowerCase() !== "i" ||
        !event.metaKey ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, toggle]);

  const toggleLabel = label === "Selected day" ? "selected day" : "details";
  const toggleButton = active ? (
    <Button
      ref={toggleRef}
      iconOnly
      size="small"
      variant="transparent"
      aria-label={`${collapsed ? "Show" : "Hide"} ${toggleLabel}`}
      aria-controls={id}
      aria-expanded={!collapsed}
      title={`${collapsed ? "Show" : "Hide"} ${toggleLabel} (⌃⌘I)`}
      onClick={toggle}
    >
      {collapsed ? <PanelRightOpen /> : <PanelRightClose />}
    </Button>
  ) : null;
  return (
    <div
      ref={root}
      className={`flex h-full min-w-0 ${stacked ? "flex-col" : ""}`}
      data-details-layout
      data-details-stacked={stacked ? "true" : undefined}
    >
      <div ref={primary} className="h-full min-h-0 min-w-0 flex-1">
        {!controls ? toggleButton : null}
        {children}
      </div>
      {active && isSide && !collapsed ? (
        <ResizeHandle
          label="Resize details"
          controls={id}
          value={fitted}
          min={INSPECTOR_SIZE.min}
          max={Math.min(INSPECTOR_SIZE.max, available - 441)}
          direction={-1}
          onResize={(dx) =>
            setWidth((current) => {
              const max = Math.min(INSPECTOR_SIZE.max, available - 441);
              return clamp(Math.min(current, max) - dx, INSPECTOR_SIZE.min, max);
            })
          }
          onCommit={() => localStorage.setItem(key, String(width))}
        />
      ) : null}
      <div
        ref={side}
        data-side-details
        hidden={!active || (!isSide && !stacked) || collapsed}
        style={stacked ? { width: "100%", height: "min(260px, 45%)" } : { width: fitted ?? 0 }}
        className={`h-full shrink-0 overflow-y-auto ${stacked ? "border-t border-separator" : ""}`}
      />
      {controls ? createPortal(toggleButton, controls) : null}
      {createPortal(
        <aside
          id={id}
          aria-label={label}
          data-inspector
          data-inspector-layout={isSide ? "side" : "inline"}
          hidden={!active || collapsed}
          className={isSide ? "px-3 pb-6 pt-4" : "p-3"}
        >
          {details}
        </aside>,
        container,
      )}
    </div>
  );
}
