import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button, Callout, Input, Text } from "@renderer/ui";

import {
  KIND_LABEL,
  aiCaptureEnabled,
  availableKinds,
  normalizeDraft,
  type ItemDraft,
  type ItemKind,
} from "@shared/capture";
import { DraftFields } from "../components/draft-fields";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { useAccounts } from "../lib/queries";
import { useSettings } from "../lib/settings";
import {
  initialCaptureState,
  reduceCapturePanel,
  type CaptureRecordView,
} from "./capture-panel-state";
import {
  hidePanel,
  showPanel,
  useFitPanelHeight,
  usePanelEscape,
  usePanelShown,
} from "./panel-ipc";

const NONE = { task: false, reminder: false, event: false };

export function CapturePanel() {
  const container = useFitPanelHeight<HTMLDivElement>("capture");
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const settings = useSettings().data;
  const accounts = useAccounts().data;
  const [state, dispatch] = useReducer(reduceCapturePanel, initialCaptureState);
  const [formError, setFormError] = useState<string | null>(null);

  const available = useMemo(
    () =>
      settings && accounts
        ? availableKinds({
            googleConnected: accounts.google.connected,
            remindersAccess: accounts.reminders,
            sources: settings.sources,
          })
        : NONE,
    [settings, accounts],
  );
  const aiAvailable = settings ? aiCaptureEnabled(settings) : false;
  const defaultKind: ItemKind =
    (["reminder", "task", "event"] as const).find((kind) => available[kind]) ?? "reminder";
  const nothingAvailable =
    accounts !== undefined && !available.task && !available.reminder && !available.event;

  useEffect(() => {
    const apply = (records: unknown) => {
      if (Array.isArray(records))
        dispatch({ type: "recordsChanged", records: records as CaptureRecordView[] });
    };
    void invoke<unknown>("capture:recent").then(apply, () => undefined);
    return window.dayboard.ipc.onNotification("capture:changed", (params) =>
      apply((params as { records?: unknown } | null)?.records),
    );
  }, []);

  useEffect(() => {
    if (settings) dispatch({ type: "shown", aiAvailable, defaultKind });
  }, [settings, aiAvailable, defaultKind]);

  usePanelEscape("capture");
  usePanelShown(() => {
    dispatch({ type: "shown", aiAvailable, defaultKind });
    setFormError(null);
    input.current?.focus();
  });

  /** Hides first, then submits; a rejection before the pipeline (license, update) comes back here. */
  function send(payload: { text: string } | { draft: ItemDraft }, text: string) {
    const key = `local-${++sequence.current}`;
    dispatch({ type: "submitted" });
    void hidePanel("capture");
    void invoke("capture:submit", payload).catch((error: unknown) => {
      dispatch({
        type: "rejected",
        key,
        text,
        error: errorMessage(error),
        partial: "draft" in payload ? payload.draft : null,
      });
      void showPanel("capture").catch(() => undefined);
    });
  }

  function submitText() {
    const text = state.text.trim();
    if (text) send({ text }, text);
  }

  function submitForm() {
    if (!state.form) return;
    const draft = normalizeDraft(state.form, available);
    if ("error" in draft) return setFormError(draft.error);
    setFormError(null);
    send({ draft }, draft.title);
  }

  return (
    <div ref={container} className="flex flex-col gap-2 p-3">
      {state.failures.map((failure) => (
        <Callout
          key={failure.key}
          color="orange"
          actions={
            <>
              <Button
                size="small"
                onClick={() => dispatch({ type: "editFailure", key: failure.key, defaultKind })}
              >
                Edit
              </Button>
              <Button
                size="small"
                variant="transparent"
                onClick={() => dispatch({ type: "dismissFailure", key: failure.key })}
              >
                Dismiss
              </Button>
            </>
          }
        >
          <Text as="span" className="font-semibold">
            Couldn’t add “{failure.text}”.
          </Text>{" "}
          {failure.error}
        </Callout>
      ))}
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
      {state.mode === "form" && state.form ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitForm();
          }}
        >
          <DraftFields
            draft={state.form}
            available={available}
            autoFocusTitle
            onChange={(patch) => dispatch({ type: "formChanged", patch })}
          />
          {formError ? <Callout color="orange">{formError}</Callout> : null}
          <div className="flex justify-end gap-2">
            {aiAvailable ? (
              <Button variant="transparent" onClick={() => dispatch({ type: "useText" })}>
                Type It Instead
              </Button>
            ) : null}
            <Button type="submit" disabled={nothingAvailable}>
              Add {KIND_LABEL[state.form.kind]}
            </Button>
          </div>
        </form>
      ) : (
        <Input
          ref={input}
          autoFocus
          aria-label="Quick Capture"
          className="h-10 text-[15px]"
          placeholder="Add a task, reminder or event — e.g. Call dentist Thursday 3pm"
          value={state.text}
          disabled={nothingAvailable}
          onChange={(event) => dispatch({ type: "typed", text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitText();
            }
          }}
        />
      )}
    </div>
  );
}
