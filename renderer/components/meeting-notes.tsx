import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, Status, Text } from "@renderer/ui";
import { FileText, ListChecks } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import {
  ACTION_ITEMS_SYSTEM,
  buildActionItemsPrompt,
  extractActionItems,
  parseActionItems,
  type ActionItem,
} from "@shared/action-items";
import { availableKinds } from "@shared/capture";
import { useAITask } from "../lib/ai";
import { createItem } from "../lib/create-items";
import { formatTimeOfDay } from "../lib/dates";
import { notesLines } from "../lib/notes-lines";
import { errorMessage, invoke, openExternal } from "../lib/ipc";
import { useAccounts } from "../lib/queries";
import { featureOn, useSettings } from "../lib/settings";

interface NotesRecord {
  providerMeetingId: string;
  providerUrl: string | null;
  title: string | null;
  importedAt: string;
  text: string;
}

interface GranolaMeeting {
  id: string;
  title: string;
  meetingAt: string | null;
}

const statusKey = ["meetings", "notes-status"] as const;
const notesKey = (event: CalendarEventItem) =>
  ["meetings", "notes", event.calendarId, event.id] as const;

/** Notes are source data: shown as plain text, with headings and bullets only. */
function NotesText({ text, compact }: { text: string; compact: boolean }) {
  return (
    <div className={compact ? "max-h-28 overflow-hidden" : "max-h-80 overflow-auto"}>
      {notesLines(text).map((line, index) => (
        <Text
          key={index}
          as="p"
          variant="small"
          className={
            line.kind === "heading"
              ? "mt-1.5 font-semibold"
              : line.kind === "bullet"
                ? "pl-3"
                : undefined
          }
        >
          {line.kind === "bullet" ? `• ${line.text}` : line.text}
        </Text>
      ))}
    </div>
  );
}

function FollowUps({ notes }: { notes: string }) {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const accounts = useAccounts().data;
  const ai = useAITask();
  const [added, setAdded] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const aiOn = featureOn(settings, "meetingPrep");
  const items: ActionItem[] =
    (ai.isDone ? parseActionItems(ai.output) : null) ?? extractActionItems(notes);
  const available =
    settings && accounts
      ? availableKinds({
          googleConnected: accounts.google.connected,
          remindersAccess: accounts.reminders,
          sources: settings.sources,
        })
      : { task: false, reminder: false, event: false };

  async function add(item: ActionItem, kind: "task" | "reminder") {
    setError(null);
    try {
      await createItem(
        { kind, title: item.title, notes: item.detail, date: "", time: "", endTime: "" },
        queryClient,
      );
      setAdded((current) => ({ ...current, [item.title]: kind === "task" ? "Task" : "Reminder" }));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Text as="h3" variant="small" color="secondary" className="flex-1">
          Follow-ups
        </Text>
        {aiOn && !ai.isDone ? (
          <Button
            size="small"
            variant="transparent"
            disabled={ai.isRunning}
            onClick={() =>
              void ai.run({
                system: ACTION_ITEMS_SYSTEM,
                prompt: buildActionItemsPrompt(notes),
                maxOutputTokens: 600,
              })
            }
          >
            <ListChecks />
            {ai.isRunning ? "Finding…" : "Find with AI"}
          </Button>
        ) : null}
      </div>
      {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
      {error ? <Callout color="orange">{error}</Callout> : null}
      {items.length ? (
        items.map((item) => (
          <div key={item.title} className="flex items-center gap-2">
            <Text as="span" variant="small" className="min-w-0 flex-1" truncate>
              {item.title}
            </Text>
            {added[item.title] ? (
              <Text as="span" variant="small" color="secondary">
                Added as {added[item.title]}
              </Text>
            ) : (
              <>
                {available.task ? (
                  <Button size="small" variant="transparent" onClick={() => void add(item, "task")}>
                    Add as Task
                  </Button>
                ) : null}
                {available.reminder ? (
                  <Button
                    size="small"
                    variant="transparent"
                    onClick={() => void add(item, "reminder")}
                  >
                    Add as Reminder
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ))
      ) : (
        <Text as="p" variant="small" color="tertiary">
          No follow-ups found in these notes.
        </Text>
      )}
    </div>
  );
}

/** Granola notes for one calendar event: the import offer, a candidate picker, then the notes. */
export function MeetingNotes({
  event,
  compact = false,
}: {
  event: CalendarEventItem;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ selection: string; candidates: GranolaMeeting[] } | null>(
    null,
  );
  const enabled = Boolean(settings?.system.meetings.notesImport);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () =>
      invoke<{ provider: { id: string; name: string } | null }>("meetings:notesStatus"),
    enabled,
  });
  const notes = useQuery({
    queryKey: notesKey(event),
    queryFn: async () =>
      (
        await invoke<Record<string, NotesRecord>>("meetings:getNotes", {
          events: [{ calendarId: event.calendarId, eventId: event.id }],
        })
      )[`${event.calendarId}/${event.id}`] ?? null,
    enabled,
  });
  if (!enabled) return null;
  const record = notes.data;
  if (!record && !status.data?.provider) return null;

  async function load(selection: string, providerMeetingId: string) {
    await invoke("meetings:importNotes", { selection, providerMeetingId });
    setChoice(null);
    await queryClient.invalidateQueries({ queryKey: notesKey(event) });
  }

  async function find() {
    setBusy(true);
    setError(null);
    try {
      const found = await invoke<{
        selection: string;
        match: GranolaMeeting | null;
        candidates: GranolaMeeting[];
      }>("meetings:findNotes", {
        calendarId: event.calendarId,
        eventId: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
      });
      if (found.match) await load(found.selection, found.match.id);
      else if (found.candidates.length) setChoice(found);
      else setError("Granola has no notes from around this meeting's time.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Meeting notes" className="flex flex-col gap-2">
      {record ? (
        <>
          <div className="flex items-center gap-2">
            <Text as="h3" variant="small" color="secondary" className="flex-1">
              Notes from Granola · {formatTimeOfDay(record.importedAt)}
            </Text>
            {record.providerUrl ? (
              <Button
                size="small"
                variant="transparent"
                onClick={() => void openExternal(record.providerUrl!)}
              >
                Open in Granola
              </Button>
            ) : null}
          </div>
          <NotesText text={record.text} compact={compact} />
          <FollowUps notes={record.text} />
        </>
      ) : choice ? (
        <div className="flex flex-col gap-1">
          <Text as="p" variant="small" color="secondary">
            Which Granola notes are from this meeting?
          </Text>
          {choice.candidates.map((meeting) => (
            <Button
              key={meeting.id}
              size="small"
              variant="transparent"
              className="justify-start"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void load(choice.selection, meeting.id)
                  .catch((reason: unknown) => setError(errorMessage(reason)))
                  .finally(() => setBusy(false));
              }}
            >
              {meeting.meetingAt ? `${formatTimeOfDay(meeting.meetingAt)} · ` : ""}
              {meeting.title || "Untitled"}
            </Button>
          ))}
        </div>
      ) : (
        <div>
          <Button size="small" disabled={busy} onClick={() => void find()}>
            <FileText />
            Get Notes from Granola
          </Button>
        </div>
      )}
      {busy ? <Status variant="loading">Checking Granola…</Status> : null}
      {error ? <Callout color="orange">{error}</Callout> : null}
    </section>
  );
}
