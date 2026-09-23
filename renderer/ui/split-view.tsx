import * as React from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import { cn } from "./utils";
import { Button, type ButtonProps } from "./button";

interface ColumnSize {
  default?: number;
  min?: number;
  max?: number;
}

interface SplitViewContextValue {
  hasSidebar: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  hasInspector: boolean;
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
}

const SplitViewContext = React.createContext<SplitViewContextValue | null>(null);

export function useSplitView(): SplitViewContextValue {
  const context = React.useContext(SplitViewContext);
  if (!context) throw new Error("useSplitView must be used inside a <SplitView>");
  return context;
}

const SplitViewColumnContext = React.createContext<{
  isFirst: boolean;
  isLast: boolean;
} | null>(null);

export function useSplitViewColumnContext(): {
  isFirst: boolean;
  isLast: boolean;
} | null {
  return React.useContext(SplitViewColumnContext);
}

function useStoredNumber(
  key: string | undefined,
  initial: number,
): [number, (value: number) => void] {
  const storageKey = key ? `dayboard:split-view:${key}` : undefined;
  const [value, setValue] = React.useState(() => {
    if (!storageKey) return initial;
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : initial;
  });
  const setAndPersist = React.useCallback(
    (next: number) => {
      setValue(next);
      if (storageKey) localStorage.setItem(storageKey, String(next));
    },
    [storageKey],
  );
  return [value, setAndPersist];
}

function useStoredBoolean(
  key: string | undefined,
  initial: boolean,
): [boolean, (value: boolean) => void] {
  const storageKey = key ? `dayboard:split-view:${key}` : undefined;
  const [value, setValue] = React.useState(() => {
    if (!storageKey) return initial;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? initial : stored === "1";
  });
  const setAndPersist = React.useCallback(
    (next: boolean) => {
      setValue(next);
      if (storageKey) localStorage.setItem(storageKey, next ? "1" : "0");
    },
    [storageKey],
  );
  return [value, setAndPersist];
}

function ResizeHandle({
  onResize,
  className,
}: {
  onResize: (deltaX: number) => void;
  className?: string;
}) {
  const dragging = React.useRef(false);
  const lastX = React.useRef(0);
  React.useEffect(() => {
    function onMove(event: MouseEvent) {
      if (!dragging.current) return;
      onResize(event.clientX - lastX.current);
      lastX.current = event.clientX;
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onResize]);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(event) => {
        dragging.current = true;
        lastX.current = event.clientX;
        document.body.style.cursor = "col-resize";
      }}
      className={cn(
        "relative w-px shrink-0 cursor-col-resize bg-separator after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-['']",
        className,
      )}
    />
  );
}

export interface SplitViewProps {
  children: React.ReactNode;
  primarySize?: { min?: number };
  sidebar?: React.ReactNode;
  sidebarSize?: ColumnSize;
  sidebarCollapsed?: boolean;
  defaultSidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  list?: React.ReactNode;
  listSize?: ColumnSize;
  inspector?: React.ReactNode;
  inspectorSize?: ColumnSize;
  inspectorCollapsed?: boolean;
  defaultInspectorCollapsed?: boolean;
  onInspectorCollapsedChange?: (collapsed: boolean) => void;
  storageKey?: string;
  className?: string;
}

export function SplitView({
  children,
  primarySize,
  sidebar,
  sidebarSize = { default: 200, min: 180, max: 300 },
  sidebarCollapsed: sidebarCollapsedProp,
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  list,
  listSize = { default: 300, min: 240 },
  inspector,
  inspectorSize = { default: 280, min: 240 },
  inspectorCollapsed: inspectorCollapsedProp,
  defaultInspectorCollapsed = false,
  onInspectorCollapsedChange,
  storageKey,
  className,
}: SplitViewProps) {
  const [sidebarWidth, setSidebarWidth] = useStoredNumber(
    storageKey && `${storageKey}:sidebar`,
    sidebarSize.default ?? 200,
  );
  const [listWidth, setListWidth] = useStoredNumber(
    storageKey && `${storageKey}:list`,
    listSize.default ?? 300,
  );
  const [inspectorWidth, setInspectorWidth] = useStoredNumber(
    storageKey && `${storageKey}:inspector`,
    inspectorSize.default ?? 280,
  );
  const [sidebarCollapsedState, setSidebarCollapsedState] = useStoredBoolean(
    storageKey && `${storageKey}:sidebar-collapsed`,
    defaultSidebarCollapsed,
  );
  const [inspectorCollapsedState, setInspectorCollapsedState] = useStoredBoolean(
    storageKey && `${storageKey}:inspector-collapsed`,
    defaultInspectorCollapsed,
  );
  const sidebarCollapsed = sidebarCollapsedProp ?? sidebarCollapsedState;
  const inspectorCollapsed = inspectorCollapsedProp ?? inspectorCollapsedState;

  const setSidebarCollapsed = React.useCallback(
    (collapsed: boolean) => {
      setSidebarCollapsedState(collapsed);
      onSidebarCollapsedChange?.(collapsed);
    },
    [onSidebarCollapsedChange, setSidebarCollapsedState],
  );
  const setInspectorCollapsed = React.useCallback(
    (collapsed: boolean) => {
      setInspectorCollapsedState(collapsed);
      onInspectorCollapsedChange?.(collapsed);
    },
    [onInspectorCollapsedChange, setInspectorCollapsedState],
  );

  const contextValue = React.useMemo<SplitViewContextValue>(
    () => ({
      hasSidebar: Boolean(sidebar),
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed(!sidebarCollapsed),
      setSidebarCollapsed,
      hasInspector: inspector !== undefined,
      inspectorCollapsed,
      toggleInspector: () => setInspectorCollapsed(!inspectorCollapsed),
      setInspectorCollapsed,
    }),
    [
      sidebar,
      sidebarCollapsed,
      setSidebarCollapsed,
      inspector,
      inspectorCollapsed,
      setInspectorCollapsed,
    ],
  );

  const columns: { key: string; node: React.ReactNode }[] = [];
  if (sidebar && !sidebarCollapsed) {
    columns.push({
      key: "sidebar",
      node: (
        <div
          style={{
            width: sidebarWidth,
            minWidth: sidebarSize.min,
            maxWidth: sidebarSize.max,
          }}
          className="h-full shrink-0 overflow-hidden"
        >
          {sidebar}
        </div>
      ),
    });
    columns.push({
      key: "sidebar-handle",
      node: (
        <ResizeHandle
          onResize={(dx) =>
            setSidebarWidth(
              Math.min(
                sidebarSize.max ?? Number.POSITIVE_INFINITY,
                Math.max(sidebarSize.min ?? 0, sidebarWidth + dx),
              ),
            )
          }
        />
      ),
    });
  }
  if (list) {
    columns.push({
      key: "list",
      node: (
        <div
          style={{
            width: listWidth,
            minWidth: listSize.min,
            maxWidth: listSize.max,
          }}
          className="h-full shrink-0 overflow-hidden"
        >
          {list}
        </div>
      ),
    });
    columns.push({
      key: "list-handle",
      node: (
        <ResizeHandle
          onResize={(dx) =>
            setListWidth(
              Math.min(
                listSize.max ?? Number.POSITIVE_INFINITY,
                Math.max(listSize.min ?? 0, listWidth + dx),
              ),
            )
          }
        />
      ),
    });
  }
  columns.push({
    key: "primary",
    node: (
      <div style={{ minWidth: primarySize?.min }} className="h-full min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
    ),
  });
  if (inspector !== undefined && !inspectorCollapsed) {
    columns.push({
      key: "inspector-handle",
      node: (
        <ResizeHandle
          onResize={(dx) =>
            setInspectorWidth(
              Math.min(
                inspectorSize.max ?? Number.POSITIVE_INFINITY,
                Math.max(inspectorSize.min ?? 0, inspectorWidth - dx),
              ),
            )
          }
        />
      ),
    });
    columns.push({
      key: "inspector",
      node: (
        <div
          style={{
            width: inspectorWidth,
            minWidth: inspectorSize.min,
            maxWidth: inspectorSize.max,
          }}
          className="h-full shrink-0 overflow-hidden"
        >
          {inspector}
        </div>
      ),
    });
  }

  const realColumns = columns.filter((column) => !column.key.endsWith("-handle"));

  return (
    <SplitViewContext.Provider value={contextValue}>
      <div className={cn("flex h-full min-h-0 w-full min-w-0", className)}>
        {columns.map((column) => {
          if (column.key.endsWith("-handle"))
            return <React.Fragment key={column.key}>{column.node}</React.Fragment>;
          const columnIndex = realColumns.findIndex((c) => c.key === column.key);
          return (
            <SplitViewColumnContext.Provider
              key={column.key}
              value={{
                isFirst: columnIndex === 0,
                isLast: columnIndex === realColumns.length - 1,
              }}
            >
              {column.node}
            </SplitViewColumnContext.Provider>
          );
        })}
      </div>
    </SplitViewContext.Provider>
  );
}

interface ToggleProps extends Omit<
  ButtonProps,
  "aria-pressed" | "aria-label" | "onClick" | "children"
> {
  pinned?: boolean;
  "aria-label"?: string;
  children?: React.ReactNode;
}

function SidebarToggle({
  pinned = true,
  "aria-label": ariaLabel,
  children,
  className,
  ...props
}: ToggleProps) {
  const { hasSidebar, sidebarCollapsed, toggleSidebar } = useSplitView();
  if (!hasSidebar) return null;
  return (
    <Button
      iconOnly
      variant="transparent"
      size="small"
      aria-label={ariaLabel ?? (sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar")}
      title={sidebarCollapsed ? "Show Sidebar (⌃⌘S)" : "Hide Sidebar (⌃⌘S)"}
      onClick={toggleSidebar}
      className={cn(pinned && "fixed left-2 top-2 z-20", className)}
      {...props}
    >
      {children ?? (sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />)}
    </Button>
  );
}

function InspectorToggle({
  pinned = true,
  "aria-label": ariaLabel,
  children,
  className,
  ...props
}: ToggleProps) {
  const { hasInspector, inspectorCollapsed, toggleInspector } = useSplitView();
  if (!hasInspector) return null;
  return (
    <Button
      iconOnly
      variant="transparent"
      size="small"
      aria-label={ariaLabel ?? (inspectorCollapsed ? "Show Inspector" : "Hide Inspector")}
      title={inspectorCollapsed ? "Show Inspector (⌃⌘I)" : "Hide Inspector (⌃⌘I)"}
      onClick={toggleInspector}
      className={cn(pinned && "fixed right-2 top-2 z-20", className)}
      {...props}
    >
      {children ?? (inspectorCollapsed ? <PanelRightOpen /> : <PanelRightClose />)}
    </Button>
  );
}

SplitView.SidebarToggle = SidebarToggle;
SplitView.InspectorToggle = InspectorToggle;
