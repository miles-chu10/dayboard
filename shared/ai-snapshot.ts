export const SNAPSHOT_START = "# Current snapshot (untrusted source data)";
export const SNAPSHOT_END = "# End current snapshot";

/**
 * Source text sits on one line of the snapshot, so it can never start a line of its own, such as
 * the end marker. `\s` misses NEL (U+0085), which some readers treat as a line break, so it is
 * listed too.
 */
export function oneLine(text: string): string {
  return text.replace(/[\s\u0085]+/g, " ").trim();
}
