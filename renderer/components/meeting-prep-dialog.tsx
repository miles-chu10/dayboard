import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Callout, Dialog, Markdown, Status, Text } from "@renderer/ui";
import { Sparkles } from "lucide-react";
import type { CalendarEventItem, MailItem, SourceResult } from "@main/shared-types";

import { useAITask } from "../lib/ai";
import { PREP_SYSTEM, buildMeetingPrepPrompt } from "../lib/ai-prompts";
import { dayHeading, eventDayKey, eventTimeRange, formatTimeOfDay } from "../lib/dates";
import { invoke } from "../lib/ipc";
import { useAccounts, useReminders, useTasks } from "../lib/queries";
import { sourceOn, useSettings } from "../lib/settings";
import { readStored, writeStored } from "../lib/storage";
import { buildTodos } from "../lib/todos";

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

interface StoredPrep {
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

const PrepContext = createContext<(event: CalendarEventItem) => void>(() => {});

export function useOpenMeetingPrep() {
  return useContext(PrepContext);
}

export function MeetingPrepProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<CalendarEventItem | null>(null);
  return (
    <PrepContext.Provider value={setEvent}>
      {children}
      {event ? (
        <MeetingPrepDialog key={event.id} event={event} onClose={() => setEvent(null)} />
      ) : null}
    </PrepContext.Provider>
  );
}

function MeetingPrepDialog({ event, onClose }: { event: CalendarEventItem; onClose: () => void }) {
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

  const text = ai.isRunning || ai.isDone ? ai.output : (stored?.markdown ?? "");
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          ai.stop();
          onClose();
        }
      }}
      size="large"
      title={event.title}
      description={`${dayHeading(eventDayKey(event))} · ${eventTimeRange(event)}${
        attendees.length
          ? ` · ${attendees.length} ${attendees.length === 1 ? "attendee" : "attendees"}`
          : ""
      }`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Text variant="small" color="tertiary" truncate className="flex-1 min-w-0">
            {contextSummary}
          </Text>
          {ai.isRunning ? (
            <Button size="small" onClick={ai.stop}>
              Stop
            </Button>
          ) : (
            <Button size="small" onClick={generate} disabled={!relatedReady}>
              <Sparkles />
              {stored ? "Regenerate" : "Prepare"}
            </Button>
          )}
        </div>
        {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
        <div className="rounded-lg bg-well px-4 py-3 min-h-24">
          {text ? (
            <Markdown isStreaming={ai.isRunning}>{text}</Markdown>
          ) : ai.isRunning ? (
            <Status variant="loading">Preparing your notes…</Status>
          ) : (
            <Text color="tertiary" as="p">
              Get the purpose, context from recent emails, open items, and talking points for this
              meeting.
            </Text>
          )}
        </div>
      </div>
    </Dialog>
  );
}
