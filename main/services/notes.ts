// Notes: local markdown notes the user writes, saves from an Assistant chat, or an agent creates.

import type { Note } from "../shared-types.js";

export const MAX_NOTES = 500;
export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_BODY = 100_000;

function isNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    Number.isFinite(note.createdAt) &&
    Number.isFinite(note.updatedAt)
  );
}

export function parseNotes(value: unknown): Note[] {
  const notes = (value as { notes?: unknown } | null)?.notes;
  return Array.isArray(notes) ? notes.filter(isNote).slice(-MAX_NOTES) : [];
}

/** Newest edit first. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A title from the first line of the body when none was given. */
export function noteTitle(title: string, body: string): string {
  const given = title.replace(/\s+/g, " ").trim();
  if (given) return given.slice(0, MAX_NOTE_TITLE);
  const firstLine = body
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return (firstLine ?? "Untitled").slice(0, MAX_NOTE_TITLE);
}

export function parseNoteInput(value: unknown): {
  id?: string;
  title: string;
  body: string;
} {
  if (typeof value !== "object" || value === null) throw new Error("A note must be an object.");
  const input = value as Record<string, unknown>;
  if (input.id !== undefined && (typeof input.id !== "string" || !input.id))
    throw new Error("A note id must be text.");
  if (input.title !== undefined && typeof input.title !== "string")
    throw new Error("A note title must be text.");
  if (typeof input.body !== "string") throw new Error("A note body must be text.");
  if (input.body.length > MAX_NOTE_BODY) throw new Error("This note is too long to save.");
  return {
    ...(input.id ? { id: input.id as string } : {}),
    title: (input.title as string | undefined) ?? "",
    body: input.body,
  };
}

/** Creates a note, or updates the one with `input.id`; returns the list and the saved note. */
export function saveNote(
  notes: Note[],
  input: { id?: string; title: string; body: string },
  now: number,
  newId: string,
): { notes: Note[]; note: Note } {
  const existing = input.id ? notes.find((note) => note.id === input.id) : undefined;
  if (input.id && !existing) throw new Error("That note no longer exists.");
  if (!existing && notes.length >= MAX_NOTES)
    throw new Error(`DayBoard keeps up to ${MAX_NOTES} notes. Delete one to add another.`);
  const note: Note = {
    id: existing?.id ?? newId,
    title: noteTitle(input.title, input.body),
    body: input.body,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    notes: existing ? notes.map((item) => (item.id === note.id ? note : item)) : [...notes, note],
    note,
  };
}
