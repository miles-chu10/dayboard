// Global-shortcut helpers shared by main (registration, conflict checks) and Settings (recorder).
// Accelerators use Electron's syntax in a fixed order: Control+Alt+Shift+Command+<Key>.

const MODIFIERS = ["Control", "Alt", "Shift", "Command"] as const;
type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  command: "Command",
  cmd: "Command",
  commandorcontrol: "Command",
  cmdorctrl: "Command",
};

const NAMED_KEYS = ["Space", "Up", "Down", "Left", "Right"];
const PUNCTUATION = ["-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "`"];

const RESERVED = new Set([
  "Command+Q",
  "Command+W",
  "Command+H",
  "Command+M",
  "Command+C",
  "Command+V",
  "Command+X",
  "Command+Z",
  "Command+A",
  "Command+Tab",
  "Command+Space",
]);

function normalizeKey(raw: string): string | null {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  if (/^f([1-9]|1[0-9]|20)$/i.test(raw)) return raw.toUpperCase();
  const named = NAMED_KEYS.find((key) => key.toLowerCase() === raw.toLowerCase());
  if (named) return named;
  return PUNCTUATION.includes(raw) ? raw : null;
}

function compose(modifiers: Iterable<Modifier>, key: string): string {
  const set = new Set(modifiers);
  return [...MODIFIERS.filter((modifier) => set.has(modifier)), key].join("+");
}

export function normalizeAccelerator(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parts = value.trim().split("+");
  const modifiers = new Set<Modifier>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (modifier) {
      if (modifiers.has(modifier)) return null;
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null;
    key = normalizeKey(part.trim());
    if (key === null) return null;
  }
  return key === null ? null : compose(modifiers, key);
}

export function validateAccelerator(
  accelerator: string,
): { ok: true } | { ok: false; reason: string } {
  const normalized = normalizeAccelerator(accelerator);
  const parts = normalized?.split("+") ?? [];
  if (
    !normalized ||
    !parts.some((part) => part === "Control" || part === "Alt" || part === "Command")
  )
    return {
      ok: false,
      reason: "Choose a key with at least one of ⌃, ⌥ or ⌘.",
    };
  if (RESERVED.has(normalized))
    return {
      ok: false,
      reason: "That shortcut is reserved by macOS or common app commands.",
    };
  return { ok: true };
}

const CODE_KEYS: Record<string, string> = {
  Space: "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Backquote: "`",
};

/** Reads `code`, not `key`, so ⌥-modified letters (⌥D types "∂") still record as D. */
export function acceleratorFromKeyEvent(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const key =
    /^Key([A-Z])$/.exec(event.code)?.[1] ??
    /^Digit([0-9])$/.exec(event.code)?.[1] ??
    (/^F([1-9]|1[0-9]|20)$/.test(event.code) ? event.code : undefined) ??
    CODE_KEYS[event.code];
  if (!key) return null;
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Command");
  return compose(modifiers, key);
}

const SYMBOLS: Record<string, string> = {
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Command: "⌘",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
};

export function formatAccelerator(accelerator: string): string {
  const normalized = normalizeAccelerator(accelerator) ?? accelerator;
  return normalized
    .split("+")
    .map((part) => SYMBOLS[part] ?? part)
    .join("");
}

/** macOS defaults for the system shortcuts most likely to collide with a capture hotkey. */
export const MACOS_SYMBOLIC_HOTKEYS: ReadonlyArray<{
  id: number;
  name: string;
  accelerator: string;
}> = [
  {
    id: 60,
    name: "Select the previous input source",
    accelerator: "Control+Space",
  },
  {
    id: 61,
    name: "Select next source in Input menu",
    accelerator: "Control+Alt+Space",
  },
  { id: 64, name: "Show Spotlight search", accelerator: "Command+Space" },
  {
    id: 65,
    name: "Show Finder search window",
    accelerator: "Alt+Command+Space",
  },
  {
    id: 28,
    name: "Save picture of screen as a file",
    accelerator: "Shift+Command+3",
  },
  {
    id: 29,
    name: "Copy picture of screen to the clipboard",
    accelerator: "Control+Shift+Command+3",
  },
  {
    id: 30,
    name: "Save picture of selected area as a file",
    accelerator: "Shift+Command+4",
  },
  {
    id: 31,
    name: "Copy picture of selected area to the clipboard",
    accelerator: "Control+Shift+Command+4",
  },
  {
    id: 184,
    name: "Screenshot and recording options",
    accelerator: "Shift+Command+5",
  },
  { id: 32, name: "Mission Control", accelerator: "Control+Up" },
  { id: 33, name: "Application windows", accelerator: "Control+Down" },
  { id: 79, name: "Move left a space", accelerator: "Control+Left" },
  { id: 81, name: "Move right a space", accelerator: "Control+Right" },
];

// macOS virtual key codes (kVK_*) for the keys an accelerator can use.
const KEY_CODES: Record<number, string> = {
  0: "A",
  1: "S",
  2: "D",
  3: "F",
  4: "H",
  5: "G",
  6: "Z",
  7: "X",
  8: "C",
  9: "V",
  11: "B",
  12: "Q",
  13: "W",
  14: "E",
  15: "R",
  16: "Y",
  17: "T",
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  22: "6",
  23: "5",
  24: "=",
  25: "9",
  26: "7",
  27: "-",
  28: "8",
  29: "0",
  30: "]",
  31: "O",
  32: "U",
  33: "[",
  34: "I",
  35: "P",
  37: "L",
  38: "J",
  39: "'",
  40: "K",
  41: ";",
  42: "\\",
  43: ",",
  44: "/",
  45: "N",
  46: "M",
  47: ".",
  49: "Space",
  50: "`",
  122: "F1",
  120: "F2",
  99: "F3",
  118: "F4",
  96: "F5",
  97: "F6",
  98: "F7",
  100: "F8",
  101: "F9",
  109: "F10",
  103: "F11",
  111: "F12",
  105: "F13",
  107: "F14",
  113: "F15",
  106: "F16",
  64: "F17",
  79: "F18",
  80: "F19",
  90: "F20",
  123: "Left",
  124: "Right",
  125: "Down",
  126: "Up",
};

const MODIFIER_MASKS: [Modifier, number][] = [
  ["Shift", 0x20000],
  ["Control", 0x40000],
  ["Alt", 0x80000],
  ["Command", 0x100000],
];

function acceleratorFromParameters(parameters: unknown): string | null {
  if (!Array.isArray(parameters) || parameters.length < 3) return null;
  const [, keyCode, mask] = parameters;
  if (typeof keyCode !== "number" || typeof mask !== "number") return null;
  const key = KEY_CODES[keyCode];
  if (!key) return null;
  return compose(
    MODIFIER_MASKS.filter(([, bit]) => (mask & bit) !== 0).map(([modifier]) => modifier),
    key,
  );
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Returns the name of the macOS shortcut that already uses `accelerator`, or null.
 * `plist` is com.apple.symbolichotkeys as JSON; an id missing from it means its macOS default
 * is active, while an entry present there (enabled or not) replaces that default.
 */
export function symbolicHotkeyConflict(plist: unknown, accelerator: string): string | null {
  const target = normalizeAccelerator(accelerator);
  if (!target) return null;
  const entries = record(record(plist).AppleSymbolicHotKeys);
  const known = new Set<string>();
  for (const shortcut of MACOS_SYMBOLIC_HOTKEYS) {
    known.add(String(shortcut.id));
    const entry = entries[String(shortcut.id)];
    if (entry === undefined) {
      if (normalizeAccelerator(shortcut.accelerator) === target) return shortcut.name;
      continue;
    }
    const item = record(entry);
    if (item.enabled === false) continue;
    const bound =
      acceleratorFromParameters(record(item.value).parameters) ??
      normalizeAccelerator(shortcut.accelerator);
    if (bound === target) return shortcut.name;
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (known.has(id)) continue;
    const item = record(entry);
    if (item.enabled !== true) continue;
    if (acceleratorFromParameters(record(item.value).parameters) === target)
      return "a macOS keyboard shortcut";
  }
  return null;
}
