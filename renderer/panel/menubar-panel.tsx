import { useEffect, useRef, useState } from "react";
import { Button, Callout, Input, Text } from "@glaze/core/components";

import { aiCaptureEnabled } from "../../shared/capture";
import { MeetingCard } from "../components/meeting-card";
import { SourceDot } from "../components/source-dot";
import { buildAgenda } from "../lib/agenda";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { longToday, todayISO } from "../lib/dates";
import { errorMessage, invoke } from "../lib/ipc";
import { useAgendaState, useCalendarRange, useReminders, useTasks } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { buildTodos, mergeLinkedTodos } from "../lib/todos";
import { useAgendaClock } from "../lib/use-agenda-clock";
import type { CaptureRecordView } from "./capture-panel-state";
import { afterRejection } from "./menubar-capture";
import {
  hidePanel,
  showPanel,
  useFitPanelHeight,
  usePanelEscape,
  usePanelShown,
} from "./panel-ipc";
import { todayItems } from "./today-items";

function openMain(route: string, prompt?: string) {
  return invoke("panel:openMain", prompt ? { route, prompt } : { route });
}

function useRecentCaptures(): CaptureRecordView[] {
  const [records, setRecords] = useState<CaptureRecordView[]>([]);
  useEffect(() => {
    const apply = (value: unknown) => {
      if (Array.isArray(value)) setRecords(value as CaptureRecordView[]);
    };
    let revision = 0;
    const stopAccounts = window.glazeAPI.glaze.ipc.onNotification("accounts:changed", () => {
      revision += 1;
      setRecords([]);
    });
    const stopRecords = window.glazeAPI.glaze.ipc.onNotification("capture:changed", (params) => {
      revision += 1;
      apply((params as { records?: unknown } | null)?.records);
    });
    void invoke<unknown>("capture:recent").then(
      (records) => {
        if (revision === 0) apply(records);
      },
      () => undefined,
    );
    return () => {
      revision += 1;
      stopAccounts();
      stopRecords();
    };
  }, []);
  return records;
}

export function MenuBarPanel() {
  const container = useFitPanelHeight<HTMLDivElement>("menubar");
  const settings = useSettings().data;
  const now = useAgendaClock();
  const today = todayISO();
  const calendar = useCalendarRange(today, 1);
  const tasks = useTasks();
  const reminders = useReminders();
  const planning = useAgendaState();
  const records = useRecentCaptures();
  const [text, setText] = useState("");
  // The rejection arrives later; it must see what is typed by then, not when it was submitted.
  const latestText = useRef(text);
  const accountRevision = useRef(0);
  useEffect(() => {
    latestText.current = text;
  }, [text]);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      window.glazeAPI.glaze.ipc.onNotification("accounts:changed", () => {
        accountRevision.current += 1;
        latestText.current = "";
        setText("");
        setError(null);
      }),
    [],
  );

  usePanelShown(() => setError(null));
  usePanelEscape("menubar");

  const on = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
    calendar: sourceOn(settings, "calendar"),
  };
  const todos = mergeLinkedTodos(
    buildTodos(tasks.data, reminders.data),
    planning.data?.duplicateLinks,
    on,
  );
  const events = identifyCalendarEvents(calendar.data?.state === "ok" ? calendar.data.items : []);
  const { overdueCount, items } = todayItems(
    buildAgenda({ events, todos, startDate: today, days: 1, now, sources: on }),
    now,
  );
  const aiCapture = settings ? aiCaptureEnabled(settings) : false;
  const canAsk = featureOn(settings, "assistant");
  const shown = records.filter((record) => record.state !== "processing").slice(0, 3);

  function capture() {
    const started = accountRevision.current;
    const value = text.trim();
    if (!value) return;
    setText("");
    setError(null);
    void invoke("capture:submit", { text: value }).catch((reason: unknown) => {
      if (started !== accountRevision.current) return;
      const next = afterRejection(latestText.current, value, errorMessage(reason));
      setText(next.text);
      setError(next.error);
    });
  }

  function undo(id: string) {
    const started = accountRevision.current;
    void invoke("capture:undo", { id }).catch((reason: unknown) => {
      if (started === accountRevision.current) setError(errorMessage(reason));
    });
  }

  return (
    <div ref={container} className="flex flex-col gap-3 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <Text as="h1" variant="large-strong">
            Today
          </Text>
          <Text as="p" variant="small" color="secondary">
            {longToday()}
            {overdueCount ? ` · ${overdueCount} overdue` : ""}
          </Text>
        </div>
        <Button size="small" variant="transparent" onClick={() => void openMain("/")}>
          Open DayBoard
        </Button>
      </div>

      <MeetingCard surface="menubar" />

      <section aria-label="Today's items" className="flex flex-col">
        {items.length ? (
          items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
              onClick={() => void openMain(item.kind === "event" ? "/calendar" : "/")}
            >
              <SourceDot source={item.source} />
              <Text
                as="span"
                variant="small"
                color="secondary"
                className="w-16 shrink-0 tabular-nums"
              >
                {item.time ?? "Anytime"}
              </Text>
              <Text as="span" variant="regular" truncate title={item.title}>
                {item.title}
              </Text>
            </button>
          ))
        ) : (
          <Text as="p" variant="small" color="secondary">
            Nothing else today.
          </Text>
        )}
      </section>

      {shown.length ? (
        <section aria-label="Recent captures" className="flex flex-col gap-1">
          <Text as="h2" variant="small" color="secondary">
            Recently added
          </Text>
          {shown.map((record) => (
            <div key={record.id} className="flex items-center gap-2">
              <Text as="span" variant="small" truncate className="flex-1">
                {record.state === "undone" ? `Undone: ${record.text}` : record.text}
                {record.error ? ` — ${record.error}` : ""}
              </Text>
              {record.canUndo ? (
                <Button size="small" variant="transparent" onClick={() => undo(record.id)}>
                  Undo
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {error ? <Callout color="red">{error}</Callout> : null}
      {aiCapture ? (
        <div className="flex gap-2">
          <Input
            aria-label="Add or ask"
            className="flex-1"
            placeholder="Add or ask…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                capture();
              }
            }}
          />
          {canAsk ? (
            <Button
              disabled={!text.trim()}
              onClick={() => void openMain("/assistant", text.trim())}
            >
              Ask
            </Button>
          ) : null}
        </div>
      ) : (
        <Button
          onClick={() => {
            void hidePanel("menubar");
            void showPanel("capture");
          }}
        >
          Add an item…
        </Button>
      )}
    </div>
  );
}
