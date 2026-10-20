import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Callout, Dialog, Input, Status, toast } from "@glaze/core/components";

import { extractJSON, useAITask } from "../lib/ai";
import { CAPTURE_SYSTEM, buildCapturePrompt } from "../lib/ai-prompts";
import { parseDraft } from "../../shared/capture";
import { KIND_LABEL, createItem, type ItemDraft, type ItemKind } from "../lib/create-items";
import { errorMessage, openSettings } from "../lib/ipc";
import { useAccounts } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { isNewItemShortcut } from "../lib/shortcuts";
import { DraftFields } from "./draft-fields";

const CaptureContext = createContext<() => void>(() => {});

export function useOpenCapture() {
  return useContext(CaptureContext);
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hasModal = () => Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
    function openFromMenu() {
      if (!hasModal()) setOpen(true);
    }
    function keydown(event: KeyboardEvent) {
      if (!isNewItemShortcut(event) || hasModal()) return;
      event.preventDefault();
      setOpen(true);
    }
    const unsubscribe = window.glazeAPI.glaze.ipc.onNotification("capture:open", openFromMenu);
    // Capture before row controls stop bubbling; the native File menu uses the same dialog.
    window.addEventListener("keydown", keydown, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", keydown, true);
    };
  }, []);

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
          <DraftFields
            draft={draft}
            available={available}
            autoFocusTitle={!aiCapture}
            onChange={update}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
