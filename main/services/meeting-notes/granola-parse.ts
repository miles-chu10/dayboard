// Reads Granola's MCP tool output (list_meetings / get_meetings), which is text with XML-like
// <meeting> elements. Built from the tools' public output shape; tolerant of extra attributes.

export interface GranolaMeeting {
  id: string;
  title: string;
  /** ISO 8601 with offset, when the recording started. */
  meetingAt: string | null;
  url: string | null;
}

const ID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|not_[a-z0-9]{14})$/i;

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g))
    result[match[1]] = decodeEntities(match[2]);
  return result;
}

function httpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function parseGranolaMeetings(text: string): GranolaMeeting[] {
  const meetings: GranolaMeeting[] = [];
  for (const match of text.matchAll(/<meeting\s([^>]*)>/g)) {
    const attrs = attributes(match[1]);
    if (!attrs.id || !ID_RE.test(attrs.id)) continue;
    meetings.push({
      id: attrs.id,
      title: attrs.title ?? "",
      meetingAt: attrs.meeting_at ?? null,
      url: httpsUrl(attrs.url),
    });
  }
  return meetings;
}

/** The summary of one meeting in get_meetings output, or that meeting's text without tags. */
export function parseGranolaNotes(
  text: string,
  meetingId: string,
): { title: string | null; text: string } | null {
  for (const match of text.matchAll(/<meeting\s([^>]*)>([\s\S]*?)<\/meeting>/g)) {
    const attrs = attributes(match[1]);
    if (attrs.id !== meetingId) continue;
    const body = match[2];
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(body)?.[1];
    const content = decodeEntities(
      summary ??
        body
          .replace(/<known_participants>[\s\S]*?<\/known_participants>/g, "")
          .replace(/<[^>]+>/g, ""),
    ).trim();
    return content ? { title: attrs.title ?? null, text: content } : null;
  }
  return null;
}
