import type { SourceColor } from "@main/shared-types";

/** CSS color for inline styles (event tints and edges). `--db-support-*` is declared outright in
 * theme.css, unlike Tailwind's `--color-support-*`, which is only emitted when a class uses it. */
export function sourceColorVar(color: SourceColor): string {
  return `var(--db-support-${color})`;
}
