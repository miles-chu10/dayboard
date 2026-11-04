import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog, KeyCaps, Text } from "@renderer/ui";

import { visibleNav, type NavId } from "../lib/navigation";
import { useSettings } from "../lib/settings";
import { readStored, writeStored } from "../lib/storage";
import {
  SHORTCUTS,
  isTypingTarget,
  matchesShortcut,
  shortcutGroups,
  viewSlot,
} from "../lib/shortcuts";

export type RightPane = "agent" | "calendar";

/** What the current view shows, so the docked Assistant can attach it as context. */
export interface ViewContext {
  view: NavId;
  title: string;
  /** A mention key (`mail:<id>`, `event:…`, a todo key) for the item open in this view. */
  itemKey?: string;
}

export interface AgentRequest {
  id: number;
  prompt: string;
}

interface ShellValue {
  rightPane: RightPane | null;
  setRightPane: (pane: RightPane | null) => void;
  toggleRightPane: (pane: RightPane) => void;
  commandMenuOpen: boolean;
  setCommandMenuOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  viewContext: ViewContext | null;
  setViewContext: React.Dispatch<React.SetStateAction<ViewContext | null>>;
  /** Opens the docked Assistant and sends `prompt` there. */
  askAgent: (prompt?: string) => void;
  agentRequest: AgentRequest | null;
  takeAgentRequest: (id: number) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

const PANE_KEY = "shell:rightPane:v1";

function isPane(value: unknown): value is RightPane {
  return value === "agent" || value === "calendar";
}

function dialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside ShellProvider");
  return value;
}

/** Publishes the current view (and its open item) for the docked Assistant while mounted. */
export function usePublishViewContext(context: ViewContext | null) {
  const { setViewContext } = useShell();
  const view = context?.view;
  const title = context?.title;
  const itemKey = context?.itemKey;
  useEffect(() => {
    if (!view || !title) return;
    // Closing an item keeps it as the view's context (a detail dialog blocks ⌥⌘J while open);
    // opening another item or leaving the view replaces it.
    setViewContext((previous) => ({
      view,
      title,
      itemKey: itemKey ?? (previous?.view === view ? previous.itemKey : undefined),
    }));
  }, [setViewContext, view, title, itemKey]);
  useEffect(() => () => setViewContext(null), [setViewContext]);
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const settings = useSettings().data;
  const [rightPane, setRightPaneState] = useState<RightPane | null>(() =>
    readStored(PANE_KEY, isPane),
  );
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [viewContext, setViewContext] = useState<ViewContext | null>(null);
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null);
  const requestId = useRef(0);

  const setRightPane = useCallback((pane: RightPane | null) => {
    setRightPaneState(pane);
    writeStored(PANE_KEY, pane);
  }, []);
  const toggleRightPane = useCallback(
    (pane: RightPane) =>
      setRightPaneState((current) => {
        const next = current === pane ? null : pane;
        writeStored(PANE_KEY, next);
        return next;
      }),
    [],
  );
  const askAgent = useCallback(
    (prompt?: string) => {
      setRightPane("agent");
      const text = prompt?.trim();
      if (text) setAgentRequest({ id: ++requestId.current, prompt: text });
    },
    [setRightPane],
  );
  const takeAgentRequest = useCallback(
    (id: number) => setAgentRequest((current) => (current?.id === id ? null : current)),
    [],
  );

  const nav = useMemo(() => visibleNav(settings), [settings]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.repeat) return;
      if (matchesShortcut(event, SHORTCUTS.commandMenu)) {
        // ⌘K closes the menu it opened; any other dialog keeps the key.
        if (dialogOpen() && !commandMenuOpen) return;
        event.preventDefault();
        setCommandMenuOpen((open) => !open);
        return;
      }
      if (dialogOpen()) return;
      if (matchesShortcut(event, SHORTCUTS.askAgent)) {
        event.preventDefault();
        toggleRightPane("agent");
      } else if (matchesShortcut(event, SHORTCUTS.calendarPeek)) {
        event.preventDefault();
        toggleRightPane("calendar");
      } else if (
        matchesShortcut(event, SHORTCUTS.shortcutsSheetAlt) ||
        (matchesShortcut(event, SHORTCUTS.shortcutsSheet) && !isTypingTarget(event.target))
      ) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else {
        const slot = viewSlot(event);
        const item = slot === null ? undefined : nav[slot];
        if (!item) return;
        event.preventDefault();
        void navigate({ to: item.route });
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [commandMenuOpen, nav, navigate, toggleRightPane]);

  const value = useMemo<ShellValue>(
    () => ({
      rightPane,
      setRightPane,
      toggleRightPane,
      commandMenuOpen,
      setCommandMenuOpen,
      shortcutsOpen,
      setShortcutsOpen,
      viewContext,
      setViewContext,
      askAgent,
      agentRequest,
      takeAgentRequest,
    }),
    [
      rightPane,
      setRightPane,
      toggleRightPane,
      commandMenuOpen,
      shortcutsOpen,
      viewContext,
      askAgent,
      agentRequest,
      takeAgentRequest,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <ShortcutsSheet
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        viewTitles={nav.map((item) => item.title)}
      />
    </ShellContext.Provider>
  );
}

function ShortcutsSheet({
  open,
  onOpenChange,
  viewTitles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewTitles: string[];
}) {
  const groups = shortcutGroups(viewTitles);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard Shortcuts" size="large">
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <Text variant="small" color="secondary" className="mb-1.5 block font-medium">
              {group.title}
            </Text>
            <ul className="divide-y divide-separator rounded-lg border border-separator">
              {group.entries.map((entry) => (
                <li key={entry.title} className="flex items-center justify-between gap-3 px-3 py-2">
                  <Text>{entry.title}</Text>
                  <span className="flex items-center gap-1.5">
                    {entry.keys.map((keys, index) => (
                      <span key={keys.join("")} className="flex items-center gap-1.5">
                        {index ? (
                          <Text variant="small" color="secondary">
                            or
                          </Text>
                        ) : null}
                        <KeyCaps keys={keys} />
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
