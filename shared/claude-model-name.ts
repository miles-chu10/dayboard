const FAMILY: Record<string, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

/**
 * A readable name for an exact model ID Claude Code reported, such as "claude-opus-5-5[1m]" →
 * "Opus 5.5 (1M context)". Null for any other shape, including an ID without a version, so
 * callers show the ID as reported instead of a guessed name.
 */
export function claudeModelName(id: string): string | null {
  const match =
    /^claude-(?:(\d{1,2})-(?:(\d{1,2})-)?)?(fable|opus|sonnet|haiku)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:-\d{8})?(\[1m\])?$/i.exec(
      id,
    );
  if (!match) return null;
  const [, oldMajor, oldMinor, family, major, minor, oneMillion] = match;
  if (Boolean(oldMajor) === Boolean(major)) return null;
  const version = [oldMajor ?? major, oldMinor ?? minor].filter(Boolean).join(".");
  return `${FAMILY[family.toLowerCase()]} ${version}${oneMillion ? " (1M context)" : ""}`;
}
