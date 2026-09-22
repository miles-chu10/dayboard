// Demo mode reads and writes a separate namespace so saved briefings and chats from real use stay hidden.
let namespace = "";

export function setStorageNamespace(value: string): void {
  namespace = value;
}

/** For small non-JSON caches such as pre-render appearance preferences. */
export function storedKey(key: string): string {
  return namespace + key;
}

export function readStored<T>(key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(namespace + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown): void {
  localStorage.setItem(namespace + key, JSON.stringify(value));
}
