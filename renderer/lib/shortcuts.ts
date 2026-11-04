export interface KeyEventLike {
  key: string;
  /** Physical key; Option changes `key` on macOS (⌥J types "∆"), so chords with ⌥ match on it. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

/** ⌘N and nothing else: Shift, Option and Control variants belong to other commands. */
export function isNewItemShortcut(event: KeyEventLike): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.defaultPrevented &&
    !event.isComposing &&
    event.key.toLowerCase() === "n"
  );
}

export interface Shortcut {
  /** `KeyboardEvent.code`, e.g. "KeyJ" or "Digit1"; required for chords with Option. */
  code?: string;
  /** `KeyboardEvent.key`, compared case-insensitively, for keys whose character matters ("?"). */
  key?: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** Omitted means Shift must be up, except for `key` shortcuts whose character needs it ("?"). */
  shift?: boolean;
}

export function matchesShortcut(event: KeyEventLike, shortcut: Shortcut): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.metaKey !== Boolean(shortcut.meta)) return false;
  if (event.ctrlKey !== Boolean(shortcut.ctrl)) return false;
  if (event.altKey !== Boolean(shortcut.alt)) return false;
  if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) return false;
  if (shortcut.code) {
    if (shortcut.shift === undefined && event.shiftKey) return false;
    return event.code === shortcut.code;
  }
  return Boolean(shortcut.key) && event.key.toLowerCase() === shortcut.key!.toLowerCase();
}

const CODE_LABEL: Record<string, string> = {
  Slash: "/",
  Comma: ",",
  Period: ".",
  BracketLeft: "[",
  BracketRight: "]",
  Enter: "↩",
  Escape: "Esc",
  Space: "Space",
  Tab: "Tab",
};

function keyLabel(shortcut: Shortcut): string {
  if (shortcut.code) {
    const code = shortcut.code;
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return CODE_LABEL[code] ?? code;
  }
  const key = shortcut.key ?? "";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The keys in macOS order (⌃⌥⇧⌘, then the key), one string per key cap. */
export function shortcutKeys(shortcut: Shortcut): string[] {
  return [
    ...(shortcut.ctrl ? ["⌃"] : []),
    ...(shortcut.alt ? ["⌥"] : []),
    ...(shortcut.shift ? ["⇧"] : []),
    ...(shortcut.meta ? ["⌘"] : []),
    keyLabel(shortcut),
  ];
}

export function formatShortcut(shortcut: Shortcut): string {
  return shortcutKeys(shortcut).join("");
}

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

/** Single-key shortcuts never fire while the user is typing in a field. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as TargetLike;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return element.getAttribute?.("role") === "textbox";
  const type = (element.getAttribute?.("type") ?? "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "submit", "reset", "color"].includes(type);
}

export const SHORTCUTS = {
  commandMenu: { code: "KeyK", meta: true },
  askAgent: { code: "KeyJ", meta: true, alt: true },
  calendarPeek: { code: "KeyK", meta: true, alt: true },
  shortcutsSheet: { key: "?" },
  shortcutsSheetAlt: { code: "Slash", meta: true },
} satisfies Record<string, Shortcut>;

/** ⌃1 … ⌃9 open the sidebar's views in order; returns the 0-based slot or null. */
export function viewSlot(event: KeyEventLike): number | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.defaultPrevented || event.isComposing) return null;
  const match = /^Digit([1-9])$/.exec(event.code ?? "");
  return match ? Number(match[1]) - 1 : null;
}

export interface ShortcutEntry {
  title: string;
  keys: string[][];
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

/** What the `?` sheet lists; each entry's keys are alternatives, each a list of key caps. */
export function shortcutGroups(viewTitles: string[]): ShortcutGroup[] {
  return [
    {
      title: "General",
      entries: [
        { title: "Command menu", keys: [shortcutKeys(SHORTCUTS.commandMenu)] },
        {
          title: "Ask the Assistant beside this page",
          keys: [shortcutKeys(SHORTCUTS.askAgent)],
        },
        {
          title: "Calendar beside this page",
          keys: [shortcutKeys(SHORTCUTS.calendarPeek)],
        },
        { title: "New item", keys: [["⌘", "N"]] },
        { title: "Settings", keys: [["⌘", ","]] },
        {
          title: "Keyboard shortcuts",
          keys: [["?"], shortcutKeys(SHORTCUTS.shortcutsSheetAlt)],
        },
        { title: "Show or hide the sidebar", keys: [["⌃", "⌘", "S"]] },
        { title: "Show or hide details", keys: [["⌃", "⌘", "I"]] },
        { title: "Back", keys: [["⌘", "["]] },
        { title: "Forward", keys: [["⌘", "]"]] },
        { title: "Search the Agenda", keys: [["⌘", "F"]] },
      ],
    },
    {
      title: "Go to",
      entries: viewTitles
        .slice(0, 9)
        .map((title, index) => ({ title, keys: [["⌃", String(index + 1)]] })),
    },
    {
      title: "Mail",
      entries: MAIL_KEYS.map(({ title, keys }) => ({
        title,
        keys: [[...keys]],
      })),
    },
  ];
}

/** Single keys in the Inbox (outside text fields), as in Gmail and HeroSpace. */
export const MAIL_KEYS = [
  { title: "Next email", keys: ["J"] },
  { title: "Previous email", keys: ["K"] },
  { title: "Open email", keys: ["↩"] },
  { title: "Mark done (archive)", keys: ["E"] },
  { title: "Reply", keys: ["R"] },
  { title: "Snooze", keys: ["S"] },
  { title: "New email", keys: ["C"] },
] as const;

/** J/K step through a list of `count` rows from `index` (-1 when nothing is focused). */
export function stepRow(index: number, count: number, key: string): number | null {
  if (!count) return null;
  const lower = key.toLowerCase();
  if (lower === "j") return index < 0 ? 0 : Math.min(index + 1, count - 1);
  if (lower === "k") return index < 0 ? 0 : Math.max(index - 1, 0);
  return null;
}
