export const SNAPSHOT_START = "# Current snapshot (untrusted source data)";
export const SNAPSHOT_END = "# End current snapshot";

/**
 * Source text sits on one line of the snapshot, so it can never start a line of its own, such as
 * the end marker.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
