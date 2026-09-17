import type { QueryClient } from "@tanstack/react-query";
import type { SourceId } from "@main/shared-types";

import { invoke } from "./ipc";
import { queryKeys } from "./queries";

export type ItemKind = "task" | "reminder" | "event";

export interface ItemDraft {
  kind: ItemKind;
  title: string;
  notes: string;
  date: string;
  time: string;
  endTime: string;
}

export const KIND_LABEL: Record<ItemKind, string> = {
  task: "Google Task",
  reminder: "Reminder",
  event: "Event",
};

export const KIND_SOURCE: Record<ItemKind, SourceId> = {
  task: "tasks",
  reminder: "reminders",
  event: "calendar",
};

export function isItemKind(value: unknown): value is ItemKind {
  return value === "task" || value === "reminder" || value === "event";
}

export async function createItem(draft: ItemDraft, queryClient: QueryClient): Promise<void> {
  const title = draft.title.trim();
  if (draft.kind === "task") {
    await invoke("tasks:create", { title, notes: draft.notes, due: draft.date || undefined });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
  } else if (draft.kind === "reminder") {
    await invoke("reminders:create", {
      title,
      notes: draft.notes,
      dueDate: draft.date || undefined,
      dueTime: draft.date && draft.time ? draft.time : undefined,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
  } else {
    if (!draft.date) throw new Error("Events need a date.");
    await invoke("calendar:create", {
      title,
      notes: draft.notes,
      date: draft.date,
      startTime: draft.time || undefined,
      endTime: draft.time && draft.endTime ? draft.endTime : undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendar });
  }
}
