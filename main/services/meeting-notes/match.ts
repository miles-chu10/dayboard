// Pairs a calendar event with Granola notes. Granola titles are AI-written and rarely match the
// calendar title, so the recording time decides first and title words only break ties.

import type { GranolaMeeting } from "./granola-parse.js";

const BEFORE_MS = 10 * 60_000;
const AFTER_MS = 5 * 60_000;
const MAX_CANDIDATES = 5;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function overlap(a: string, b: string): number {
  const left = words(a);
  let count = 0;
  for (const word of words(b)) if (left.has(word)) count += 1;
  return count;
}

export function matchMeeting(
  event: { title: string; start: string; end: string },
  candidates: GranolaMeeting[],
): { match: GranolaMeeting | null; candidates: GranolaMeeting[] } {
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  const at = (meeting: GranolaMeeting) =>
    meeting.meetingAt ? new Date(meeting.meetingAt).getTime() : Number.NaN;
  const nearest = candidates
    .filter((meeting) => Number.isFinite(at(meeting)))
    .sort((a, b) => Math.abs(at(a) - start) - Math.abs(at(b) - start))
    .slice(0, MAX_CANDIDATES);
  const inWindow = nearest.filter(
    (meeting) => at(meeting) >= start - BEFORE_MS && at(meeting) <= end + AFTER_MS,
  );
  if (inWindow.length === 1) return { match: inWindow[0], candidates: nearest };
  if (inWindow.length > 1) {
    const scored = inWindow
      .map((meeting) => ({ meeting, score: overlap(event.title, meeting.title) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && scored[0].score > scored[1].score)
      return { match: scored[0].meeting, candidates: nearest };
  }
  return { match: null, candidates: nearest };
}
