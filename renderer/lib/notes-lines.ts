export interface NotesLine {
  kind: "heading" | "bullet" | "text";
  text: string;
}

/** Meeting notes as plain lines: Markdown headings and bullets only, never HTML. */
export function notesLines(text: string): NotesLine[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      const content = (heading?.[1] ?? bullet?.[1] ?? line).replace(/\*\*/g, "").trim();
      return { kind: heading ? "heading" : bullet ? "bullet" : "text", text: content };
    });
}
