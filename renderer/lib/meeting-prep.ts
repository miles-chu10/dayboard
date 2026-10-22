// Meeting prep shared by the prep dialog and the Up Next card: related mail and to-dos, the AI
// run, and the per-event cache in `dashboard:prep:v1` (shared by every DayBoard window).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEventItem, MailItem, SourceResult } from "@main/shared-types";

import { useAITask } from "./ai";
import { PREP_SYSTEM, buildMeetingPrepPrompt } from "./ai-prompts";
import { formatTimeOfDay } from "./dates";
import { invoke } from "./ipc";
import { useAccounts, useReminders, useTasks } from "./queries";
import { sourceOn, useSettings } from "./settings";
import { readStored, writeStored } from "./storage";
import { buildTodos } from "./todos";

const STORAGE_KEY = "dashboard:prep:v1";
const MAX_STORED = 40;
const STOP_WORDS = new Set([
  "with",
  "sync",
  "meeting",
  "call",
  "weekly",
  "daily",
  "team",
  "chat",
  "review",
  "about",
]);

export interface StoredPrep {
  generatedAt: string;
  markdown: string;
}

type PrepMap = Record<string, StoredPrep>;

function isPrepMap(value: unknown): value is PrepMap {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as StoredPrep).markdown === "string",
    )
  );
}

export function useMeetingPrep(event: CalendarEventItem) {
  const settings = useSettings().data;
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const ai = useAITask();
  const [stored, setStored] = useState<StoredPrep | null>(
    () => readStored(STORAGE_KEY, isPrepMap)?.[event.id] ?? null,
  );

  const selfEmail = accounts.data?.google.email?.toLowerCase();
  const attendees = event.attendees.filter((email) => email.toLowerCase() !== selfEmail);
  const mailOn = sourceOn(settings, "mail");

  const related = useQuery({
    queryKey: ["mail-related", event.id],
    queryFn: () =>
      invoke<SourceResult<MailItem>>("mail:related", { emails: attendees, keywords: event.title }),
    enabled: mailOn,
    staleTime: 5 * 60_000,
  });

  const keywords = event.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  const relatedTodos = buildTodos(tasks.data, reminders.data)
    .filter(
      (todo) => !todo.completed && keywords.some((word) => todo.title.toLowerCase().includes(word)),
    )
    .slice(0, 10);
  const relatedMail = related.data?.state === "ok" ? related.data.items : null;
  const relatedReady = !mailOn || !related.isPending;

  useEffect(() => {
    if (!ai.isDone) return;
    const next = { generatedAt: new Date().toISOString(), markdown: ai.output };
    const map = { ...(readStored(STORAGE_KEY, isPrepMap) ?? {}), [event.id]: next };
    writeStored(STORAGE_KEY, Object.fromEntries(Object.entries(map).slice(-MAX_STORED)));
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setStored(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ai.isDone, ai.output, event.id]);

  function generate() {
    void ai.run({
      system: PREP_SYSTEM,
      prompt: buildMeetingPrepPrompt({ event, attendees, relatedMail, relatedTodos }),
      maxOutputTokens: 800,
    });
  }

  const contextSummary = [
    mailOn
      ? related.isPending
        ? "Finding related emails…"
        : `${relatedMail?.length ?? 0} related emails`
      : null,
    `${relatedTodos.length} related to-dos`,
    stored && !ai.isRunning ? `prepared ${formatTimeOfDay(stored.generatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    ai,
    attendees,
    stored,
    text: ai.isRunning || ai.isDone ? ai.output : (stored?.markdown ?? ""),
    relatedReady,
    contextSummary,
    generate,
  };
}
