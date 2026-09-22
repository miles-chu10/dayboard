import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Callout,
  Dialog,
  Field,
  FieldGroup,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Status,
  toast,
} from "@glaze/core/components";

import { extractJSON, useAITask } from "../lib/ai";
import { CAPTURE_SYSTEM, buildCapturePrompt } from "../lib/ai-prompts";
import {
  KIND_LABEL,
  KIND_SOURCE,
  createItem,
  isItemKind,
  type ItemDraft,
  type ItemKind,
} from "../lib/create-items";
import { errorMessage, openSettings } from "../lib/ipc";
import { useAccounts } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { SourceDot } from "./source-dot";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function parseDraft(text: string, available: Record<ItemKind, boolean>): ItemDraft | null {
  const value = extractJSON(text);
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const read = (key: string, pattern?: RegExp) => {
    const field = record[key];
    return typeof field === "string" && (!pattern || pattern.test(field.trim()))
      ? field.trim()
      : "";
  };
  const title = read("title");
  if (!title) return null;
  let kind: ItemKind = isItemKind(record.kind) ? record.kind : "task";
  if (!available[kind]) {
    kind =
      (["reminder", "task", "event"] as const).find((candidate) => available[candidate]) ?? kind;
  }
  return {
    kind,
    title,
    notes: read("notes"),
    date: read("date", DATE_RE),
    time: read("time", TIME_RE),
    endTime: read("endTime", TIME_RE),
  };
}

const CaptureContext = createContext<() => void>(() => {});

export function useOpenCapture() {
  return useContext(CaptureContext);
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <CaptureContext.Provider value={() => setOpen(true)}>
      {children}
      <CaptureDialog open={open} onOpenChange={setOpen} />
    </CaptureContext.Provider>
  );
}

function CaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const accounts = useAccounts();
  const ai = useAITask();
  const [sentence, setSentence] = useState("");
  const [draft, setDraft] = useState<ItemDraft | null>(null);

  const googleConnected = accounts.data?.google.connected ?? false;
  const available: Record<ItemKind, boolean> = {
    task: googleConnected && sourceOn(settings, "tasks"),
    reminder: accounts.data?.reminders === "full-access" && sourceOn(settings, "reminders"),
    event: googleConnected && sourceOn(settings, "calendar"),
  };
  const nothingAvailable =
    accounts.data !== undefined && !available.task && !available.reminder && !available.event;
  const aiCapture = featureOn(settings, "capture");
  const firstAvailable =
    (["task", "reminder", "event"] as const).find((kind) => available[kind]) ?? "task";

  useEffect(() => {
    if (!ai.isDone) return;
    const parsed = parseDraft(ai.output, available);
    if (parsed) setDraft(parsed);
  }, [ai.isDone, ai.output, available.task, available.reminder, available.event]);

  // Without AI capture, go straight to the form.
  useEffect(() => {
    if (open && !aiCapture && !draft) {
      setDraft({ kind: firstAvailable, title: "", notes: "", date: "", time: "", endTime: "" });
    }
  }, [open, aiCapture, draft, firstAvailable]);

  const parseFailed = ai.isDone && !draft && extractJSON(ai.output) === undefined;

  function handleOpenChange(next: boolean) {
    if (!next) {
      ai.clear();
      setSentence("");
      setDraft(null);
    }
    onOpenChange(next);
  }

  function parse() {
    if (!sentence.trim() || ai.isRunning) return;
    setDraft(null);
    void ai.run({
      system: CAPTURE_SYSTEM,
      prompt: buildCapturePrompt(sentence, available),
      maxOutputTokens: 300,
    });
  }

  function fillManually() {
    setDraft({
      kind: firstAvailable,
      title: sentence.trim(),
      notes: "",
      date: "",
      time: "",
      endTime: "",
    });
  }

  function update(patch: Partial<ItemDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function create() {
    if (!draft) return;
    try {
      await createItem(draft, queryClient);
      toast.success(`${KIND_LABEL[draft.kind]} added: ${draft.title.trim()}`);
      handleOpenChange(false);
    } catch (error) {
      toast.error(`Couldn't add ${KIND_LABEL[draft.kind].toLowerCase()}: ${errorMessage(error)}`);
      throw error;
    }
  }

  const canCreate =
    Boolean(draft?.title.trim()) &&
    Boolean(draft && available[draft.kind]) &&
    (draft?.kind !== "event" || Boolean(draft?.date));

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      size="large"
      title="New Item"
      description={
        aiCapture
          ? "Describe it in plain language and AI will fill in the details."
          : "Add a task, reminder, or event."
      }
      confirmLabel={draft ? `Add ${KIND_LABEL[draft.kind]}` : "Add"}
      confirmDisabled={!canCreate}
      onConfirm={create}
    >
      <div className="flex flex-col gap-3">
        {nothingAvailable ? (
          <Callout
            color="orange"
            actions={
              <Button size="small" onClick={() => void openSettings()}>
                Settings
              </Button>
            }
          >
            Connect Google or allow Reminders access to add items.
          </Callout>
        ) : null}
        {aiCapture ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                className="flex-1"
                value={sentence}
                onChange={(event) => setSentence(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    parse();
                  }
                }}
                placeholder="e.g. Lunch with Sam Friday at 12:30"
              />
              {ai.isRunning ? (
                <Button onClick={ai.stop}>Stop</Button>
              ) : (
                <Button onClick={parse} disabled={!sentence.trim() || nothingAvailable}>
                  Fill In
                </Button>
              )}
            </div>
            {ai.isRunning ? <Status variant="loading">Reading your request…</Status> : null}
            {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
            {parseFailed ? (
              <Callout color="yellow">
                Couldn't understand that. Rephrase it or fill in the details yourself.
              </Callout>
            ) : null}
            {!draft && !ai.isRunning && sentence.trim() ? (
              <div>
                <Button size="small" variant="transparent" onClick={fillManually}>
                  Fill In Manually
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {draft ? (
          <FieldGroup>
            <Field label="Type">
              <SegmentedControl
                size="small"
                value={draft.kind}
                onValueChange={(value) => update({ kind: value as ItemKind })}
                aria-label="Item type"
              >
                {(["task", "reminder", "event"] as const).map((kind) => (
                  <SegmentedControlItem key={kind} value={kind} disabled={!available[kind]}>
                    <span className="flex items-center gap-1.5">
                      <SourceDot source={KIND_SOURCE[kind]} />
                      {kind === "task" ? "Task" : kind === "reminder" ? "Reminder" : "Event"}
                    </span>
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </Field>
            <Field label="Title">
              <Input
                className="w-64"
                autoFocus={!aiCapture}
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
            <Field
              label={draft.kind === "event" ? "Date" : "Due"}
              description={
                draft.kind === "event" && !draft.date ? "Events need a date." : undefined
              }
            >
              <Input
                type="date"
                className="w-64"
                value={draft.date}
                onChange={(event) => update({ date: event.target.value })}
              />
            </Field>
            {draft.kind !== "task" ? (
              <Field
                label={draft.kind === "event" ? "Starts" : "Time"}
                description={
                  draft.kind === "event" ? "Leave empty for an all-day event." : undefined
                }
              >
                <Input
                  type="time"
                  className="w-64"
                  value={draft.time}
                  onChange={(event) => update({ time: event.target.value })}
                />
              </Field>
            ) : null}
            {draft.kind === "event" && draft.time ? (
              <Field label="Ends" description="Defaults to one hour.">
                <Input
                  type="time"
                  className="w-64"
                  value={draft.endTime}
                  onChange={(event) => update({ endTime: event.target.value })}
                />
              </Field>
            ) : null}
          </FieldGroup>
        ) : null}
      </div>
    </Dialog>
  );
}
