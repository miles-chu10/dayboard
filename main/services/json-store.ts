import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";

/** A small JSON file, read once and then changed one update at a time. */
export function createJsonStore<T>(options: {
  path: () => string;
  /** Turns whatever is on disk (null when missing or unreadable) into a valid value. */
  parse: (value: unknown) => T;
}) {
  const queue = createSerialQueue();
  let cache: { path: string; value: T } | null = null;

  async function load(): Promise<T> {
    const target = options.path();
    if (cache?.path === target) return cache.value;
    let parsed: unknown = null;
    try {
      const raw = await readFileIfExists(target);
      parsed = raw ? JSON.parse(raw.toString("utf8")) : null;
    } catch {
      parsed = null;
    }
    const value = options.parse(parsed);
    cache = { path: target, value };
    return value;
  }

  return {
    read: () => queue(load),
    update: (change: (value: T) => T) =>
      queue(async () => {
        const next = change(await load());
        const target = options.path();
        await writeFileAtomic(target, JSON.stringify(next));
        cache = { path: target, value: next };
        return next;
      }),
  };
}
