import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  toast,
} from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { ChevronDown, CircleAlert, CircleDashed, Mail, Plus, Sparkles, X } from "lucide-react";
import type { MailItem } from "@main/shared-types";

import { AgendaList, eventEntry, todoEntry } from "../components/agenda-list";
import { displayName } from "../components/app-sidebar";
import { useOpenCapture } from "../components/capture-dialog";
import { HistoryNav } from "../components/history-nav";
import { MeetingCard } from "../components/meeting-card";
import { useOpenItem } from "../components/open-item";
import { usePublishViewContext } from "../components/shell";
import { ViewActions } from "../components/view-actions";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { addDays, dayHeading, toISODate } from "../lib/dates";
import { groupByDay } from "../lib/day-items";
import {
  ageLabel,
  firstName,
  greeting,
  homeSummary,
  homeTodos,
  isStale,
  needsYou,
  suggestedTasks,
  type HomeSpan,
  type NeedsYouItem,
} from "../lib/home";
import { errorMessage, invoke } from "../lib/ipc";
import {
  queryKeys,
  toggleFocus,
  useAccounts,
  useAgendaState,
  useCalendarRange,
  useMail,
  useReminders,
  useTasks,
} from "../lib/queries";
import { autoTriageOn, featureOn, sourceOn, useSettings } from "../lib/settings";
import { readStored, writeStored } from "../lib/storage";
import { buildTodos, mergeLinkedTodos } from "../lib/todos";
import { useAutoTriage, useTriage } from "../lib/triage";
import { useAgendaClock } from "../lib/use-agenda-clock";

const SPAN_KEY = "home:span:v1";
const HANDLED_KEY = "home:suggestions:v1";
const PREVIEW = 5;

const isSpan = (value: unknown): value is HomeSpan => value === "today" || value === "week";
const isKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function Card({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex min-w-0 flex-col gap-1 rounded-xl bg-well px-2 pb-2 pt-1", className)}
    >
      <div className="flex min-h-9 items-center gap-2 px-2">
        <Text variant="strong" as="h2" className="min-w-0 truncate">
          {title}
        </Text>
        {count !== undefined ? (
          <Text variant="small" color="secondary" className="tabular-nums">
            {count}
          </Text>
        ) : null}
        <span className="ml-auto flex items-center gap-1">{action}</span>
      </div>
      {children}
    </section>
  );
}

function MoreToggle({
  hidden,
  open,
  onToggle,
}: {
  hidden: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (hidden <= 0 && !open) return null;
  return (
    <Button size="small" variant="transparent" className="self-start" onClick={onToggle}>
      {open ? "Show less" : `Show ${hidden} more`}
      <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
    </Button>
  );
}

function NeedsYouRow({
  item,
  now,
  onOpen,
}: {
  item: NeedsYouItem;
  now: number;
  onOpen: () => void;
}) {
  const stale = isStale(item.since, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${item.title}: ${item.detail}, ${item.chip}, ${ageLabel(item.since, now)}`}
      className={cn(
        "grid w-full grid-cols-[1rem_minmax(6rem,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left",
        "hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-accent",
      )}
    >
      <Mail aria-hidden="true" className="size-4 text-secondary" />
      <Text variant="strong" truncate>
        {item.title}
      </Text>
      <span className="flex min-w-0 items-center gap-2">
        <Text color="secondary" truncate className="min-w-0">
          {item.detail}
        </Text>
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1 rounded-full bg-control px-2 py-0.5 text-small text-secondary @2xl:inline-flex",
            item.kind === "follow-up" && "text-support-orange",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              item.kind === "reply"
                ? "bg-support-orange"
                : item.kind === "follow-up"
                  ? "bg-support-red"
                  : "bg-support-blue",
            )}
          />
          <span className="max-w-56 truncate">{item.chip}</span>
        </span>
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-small tabular-nums",
          stale ? "text-support-orange" : "text-secondary",
        )}
      >
        {stale ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
        {ageLabel(item.since, now)}
      </span>
    </button>
  );
}

export function HomeView() {
  usePublishViewContext({ view: "home", title: "Home" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const accounts = useAccounts();
  const now = useAgendaClock();
  const today = toISODate(now);
  const [span, setSpanState] = useState<HomeSpan>(() => readStored(SPAN_KEY, isSpan) ?? "today");
  const setSpan = (next: HomeSpan) => {
    setSpanState(next);
    writeStored(SPAN_KEY, next);
  };
  const [handled, setHandled] = useState<string[]>(() => readStored(HANDLED_KEY, isKeys) ?? []);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [showAllSuggested, setShowAllSuggested] = useState(false);
  const { openMail, openEvent, openTodo } = useOpenItem();
  const openCapture = useOpenCapture();

  const days = span === "today" ? 1 : 7;
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index));
  const calendar = useCalendarRange(today, days);
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const planning = useAgendaState();
  const mailOn = sourceOn(settings, "mail");
  const calendarOn = sourceOn(settings, "calendar");
  const triageOn = featureOn(settings, "triage");
  const messages = useMemo(
    () => (mailOn && mail.data?.state === "ok" ? mail.data.items : []),
    [mail.data, mailOn],
  );
  const triage = useTriage(messages);
  useAutoTriage(triage, messages, autoTriageOn(settings));
  const triageMap = triageOn ? triage.map : {};

  const waiting = needsYou({ messages, triage: triageMap, now: now.getTime() });
  const suggested = triageOn ? suggestedTasks({ messages, triage: triageMap, handled }) : [];
  const visible = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
  };
  const todos = homeTodos(
    mergeLinkedTodos(
      buildTodos(tasks.data, reminders.data),
      planning.data?.duplicateLinks,
      visible,
    ).filter((todo) => visible[todo.source]),
    today,
    span,
  );
  const events = identifyCalendarEvents(
    calendarOn && calendar.data?.state === "ok" ? calendar.data.items : [],
  );
  const byDay = groupByDay(events, [], dates);
  const meetingCount = dates.reduce(
    (total, date) => total + (byDay.get(date)?.timed.length ?? 0),
    0,
  );
  const untriaged = messages.some((message) => !triage.map[message.id]);

  const name = firstName(displayName(settings, accounts.data?.google.email));
  const dateLine = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function handle(key: string) {
    setHandled((previous) => {
      const next = [...previous.filter((item) => item !== key), key].slice(-300);
      writeStored(HANDLED_KEY, next);
      return next;
    });
  }

  const addSuggested = useMutation({
    mutationFn: ({ title, mail: message }: { key: string; title: string; mail: MailItem }) =>
      invoke("tasks:create", {
        title,
        notes: `From email: ${message.subject} (${message.from})`,
      }),
    onSuccess: (_data, { key, title }) => {
      handle(key);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast.success(`Added “${title}” to Google Tasks`);
    },
    onError: (error) => toast.error(`Couldn't add task: ${errorMessage(error)}`),
  });

  const shownWaiting = showAllWaiting ? waiting : waiting.slice(0, PREVIEW);
  const shownSuggested = showAllSuggested ? suggested : suggested.slice(0, PREVIEW);

  return (
    <ScrollArea
      className="h-full"
      leading={<HistoryNav />}
      title="Home"
      actions={
        <ViewActions
          refreshing={mail.isFetching || calendar.isFetching || tasks.isFetching}
          onRefresh={() => {
            void mail.refetch();
            void calendar.refetch();
            void tasks.refetch();
            void reminders.refetch();
          }}
        />
      }
    >
      <div className="@container mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-8 pt-1">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Text asChild variant="heading1">
              <h2 className="text-heading1 text-balance">
                {greeting(now.getHours())}
                {name ? `, ${name}` : ""}
              </h2>
            </Text>
            <Text color="secondary">
              {dateLine}.{" "}
              {homeSummary({
                waiting: waiting.length,
                suggested: suggested.length,
                meetings: meetingCount,
                span,
              })}
            </Text>
          </div>
          <SegmentedControl
            size="small"
            value={span}
            onValueChange={(next: string) => isSpan(next) && setSpan(next)}
            aria-label="Home range"
          >
            <SegmentedControlItem value="today">Today</SegmentedControlItem>
            <SegmentedControlItem value="week">This week</SegmentedControlItem>
          </SegmentedControl>
        </header>

        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)]">
          <div className="flex min-w-0 flex-col gap-6">
            <MeetingCard surface="agenda" />

            {mailOn ? (
              <Card
                title="Needs you"
                count={waiting.length}
                action={
                  <>
                    {triageOn && untriaged ? (
                      <Button
                        size="small"
                        variant="transparent"
                        onClick={triage.isRunning ? triage.stop : triage.run}
                      >
                        <Sparkles />
                        {triage.isRunning ? "Stop" : "Review inbox"}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => void navigate({ to: "/mail" })}
                    >
                      Open Inbox
                    </Button>
                  </>
                }
              >
                {mail.isPending ? (
                  <Text color="tertiary" className="px-2 py-2">
                    Loading…
                  </Text>
                ) : waiting.length ? (
                  <div className="flex flex-col">
                    {shownWaiting.map((item) => (
                      <NeedsYouRow
                        key={item.key}
                        item={item}
                        now={now.getTime()}
                        onOpen={() => openMail(item.mail.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <Text color="tertiary" className="px-2 py-2">
                    Nothing is waiting on you.
                  </Text>
                )}
                <MoreToggle
                  hidden={waiting.length - shownWaiting.length}
                  open={showAllWaiting}
                  onToggle={() => setShowAllWaiting((open) => !open)}
                />
              </Card>
            ) : null}

            {triageOn && mailOn ? (
              <Card
                title="Suggested"
                count={suggested.length}
                action={
                  <Text variant="small" color="secondary">
                    From your mail
                  </Text>
                }
              >
                {suggested.length ? (
                  <ul className="flex flex-col">
                    {shownSuggested.map((task) => (
                      <li
                        key={task.key}
                        className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-list-hover"
                      >
                        <CircleDashed
                          aria-hidden="true"
                          className="size-4 shrink-0 text-secondary"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <Text truncate>{task.title}</Text>
                          <Text variant="small" color="secondary" truncate>
                            {task.mail.from} · {task.mail.subject}
                          </Text>
                        </span>
                        <Button
                          size="small"
                          aria-label={`Add task: ${task.title}`}
                          disabled={addSuggested.isPending}
                          onClick={() => addSuggested.mutate(task)}
                        >
                          <Plus />
                          Add
                        </Button>
                        <Button
                          size="small"
                          iconOnly
                          variant="transparent"
                          aria-label={`Dismiss suggestion: ${task.title}`}
                          title="Dismiss"
                          onClick={() => handle(task.key)}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Text color="tertiary" className="px-2 py-2">
                    {untriaged
                      ? "Review your inbox to find tasks hiding in your mail."
                      : "No new tasks in your mail."}
                  </Text>
                )}
                <MoreToggle
                  hidden={suggested.length - shownSuggested.length}
                  open={showAllSuggested}
                  onToggle={() => setShowAllSuggested((open) => !open)}
                />
              </Card>
            ) : null}

            <Card
              title="Your tasks"
              count={todos.length}
              action={
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => void navigate({ to: "/agenda" })}
                >
                  Open Agenda
                </Button>
              }
            >
              <div className="px-1">
                {todos.length ? (
                  <AgendaList
                    entries={todos.map(todoEntry)}
                    now={now}
                    focusKeys={planning.data?.focusKeys ?? []}
                    onOpen={openTodo}
                    onPin={(todo) => toggleFocus(planning, todo)}
                  />
                ) : (
                  <Text color="tertiary" className="px-1 py-2">
                    {span === "today" ? "Nothing due today." : "Nothing due this week."}
                  </Text>
                )}
              </div>
              <Button
                size="small"
                variant="transparent"
                className="self-start"
                onClick={openCapture}
              >
                <Plus />
                New item
              </Button>
            </Card>
          </div>

          {calendarOn ? (
            <Card title="Meetings" count={meetingCount} className="self-start">
              <div className="flex flex-col gap-3 px-1 pb-1">
                {dates.map((date) => {
                  const day = byDay.get(date);
                  const entries = [...(day?.allDay ?? []), ...(day?.timed ?? [])].map(eventEntry);
                  if (span === "week" && !entries.length) return null;
                  return (
                    <div key={date} className="flex flex-col gap-1.5">
                      {span === "week" ? (
                        <Text variant="small-strong" color="secondary" className="px-1">
                          {dayHeading(date)}
                        </Text>
                      ) : null}
                      {entries.length ? (
                        <AgendaList
                          entries={entries}
                          now={now}
                          focusKeys={[]}
                          onOpen={openTodo}
                          onOpenEvent={(event) => openEvent(event)}
                          onPin={() => undefined}
                        />
                      ) : (
                        <Text color="tertiary" className="px-1">
                          {calendar.isPending ? "Loading…" : "No meetings today."}
                        </Text>
                      )}
                    </div>
                  );
                })}
                {span === "week" && !meetingCount && !calendar.isPending ? (
                  <Text color="tertiary" className="px-1">
                    No meetings this week.
                  </Text>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}
