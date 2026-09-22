import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Button,
  Callout,
  Checkbox,
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleChevron,
  Dialog,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  toast,
} from "@glaze/core/components";
import { ChevronLeft, ChevronRight, CircleAlert, Search, Sparkles } from "lucide-react";
import type { CalendarEventItem, MailItem, SourceId } from "@main/shared-types";

import { AgendaDetailDialog } from "../components/agenda-detail-dialog";
import { AgendaList, todoEntry, eventEntry } from "../components/agenda-list";
import { AgendaSourceStatus } from "../components/agenda-source-status";
import { AskAssistantCard } from "../components/ask-assistant-card";
import { EventDetail } from "../components/event-detail";
import { BriefingCard } from "../components/briefing-card";
import { MailDetail } from "../components/mail-detail";
import { MailRow } from "../components/mail-row";
import { ReplyDialog } from "../components/reply-dialog";
import { RowsSkeleton, SectionCard, ListCard, InlineHint } from "../components/section-card";
import { SourceIcon } from "../components/source-dot";
import { UpNextCard } from "../components/up-next-card";
import { HistoryNav } from "../components/history-nav";
import { ViewActions } from "../components/view-actions";
import { buildAgenda } from "../lib/agenda";
import {
  calendarEventKey,
  identifyCalendarEvents,
  selectedCalendarEvent,
} from "../lib/calendar-identity";
import { CALENDAR_OPTIONS } from "../lib/calendar-range-options";
import { agendaSpanDays, type AgendaSearch, type AgendaSpan } from "../lib/agenda-search";
import { buildBriefingPrompt } from "../lib/ai-prompts";
import { addDays, dayHeading, formatTimeOfDay, parseISODate, toISODate } from "../lib/dates";
import { openSettings } from "../lib/ipc";
import { useAgendaState, useCalendarRange, useMail, useReminders, useTasks } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { SOURCE_META } from "../lib/sources";
import { readStored, writeStored } from "../lib/storage";
import { buildTodos, mergeLinkedTodos, type Todo } from "../lib/todos";
import { useTriage } from "../lib/triage";
import { useAgendaClock } from "../lib/use-agenda-clock";

type Layers = Record<"tasks" | "reminders" | "calendar" | "mail", boolean>;
const LAYERS_KEY = "dashboard:calendarLayers:v1";
function isLayers(value: unknown): value is Layers {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.tasks === "boolean" &&
    typeof data.reminders === "boolean" &&
    (data.calendar === undefined || typeof data.calendar === "boolean") &&
    (data.mail === undefined || typeof data.mail === "boolean")
  );
}

/** Gmail on the Agenda: the day's received mail collapses into one row, like overdue tasks. */
function MailDigest({ messages, children }: { messages: MailItem[]; children: ReactNode }) {
  const unread = messages.filter((message) => message.unread).length;
  return (
    <CollapsibleRoot>
      <CollapsibleTrigger className="w-full rounded-md px-2 min-h-[var(--density-row)] hover:bg-list-hover">
        <CollapsibleChevron />
        <SourceIcon source="mail" />
        <Text variant="strong">
          {messages.length} {messages.length === 1 ? "email" : "emails"}
        </Text>
        {unread ? (
          <Text variant="small" color="secondary">
            {unread} unread
          </Text>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}

function Disclosure({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <CollapsibleRoot>
      <CollapsibleTrigger className="w-full">
        <CollapsibleChevron />
        <Text variant="strong">{title}</Text>
        <Text variant="small" color="tertiary" className="ml-auto tabular-nums">
          {count}
        </Text>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}

/** Google Calendar-style summary row: all overdue items collapse into one line above the day. */
function OverdueSummary({ count, children }: { count: number; children: ReactNode }) {
  return (
    <CollapsibleRoot>
      <CollapsibleTrigger className="w-full rounded-md px-2 min-h-[var(--density-row)] hover:bg-list-hover">
        <CollapsibleChevron />
        <CircleAlert className="size-4 shrink-0 text-support-red" aria-hidden="true" />
        <Text variant="strong">
          {count} overdue {count === 1 ? "task" : "tasks"}
        </Text>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}

export function AgendaView({
  calendarRoute = false,
  modeSwitch,
}: {
  calendarRoute?: boolean;
  /** Calendar route: Month / Week / Schedule switcher shown before the range picker. */
  modeSwitch?: ReactNode;
}) {
  const now = useAgendaClock();
  const today = toISODate(now);
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const settings = useSettings().data;
  const startDate = search.date ?? today;
  const span: AgendaSpan =
    search.span ?? (calendarRoute ? (settings?.calendar.range ?? "next-7-days") : "today");
  const days = agendaSpanDays(span, startDate);
  const calendar = useCalendarRange(startDate, days);
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const planning = useAgendaState();
  const allTodos = buildTodos(tasks.data, reminders.data);
  const events = identifyCalendarEvents(calendar.data?.state === "ok" ? calendar.data.items : []);
  const messages = mail.data?.state === "ok" ? mail.data.items : [];
  const triage = useTriage(messages);
  const [replyTo, setReplyTo] = useState<MailItem | null>(null);
  const [selectedMailId, setSelectedMailId] = useState<string | undefined>();
  const [prioritize, setPrioritize] = useState(false);
  const [layers, setLayers] = useState<Layers>(() => {
    const stored = readStored(LAYERS_KEY, isLayers);
    return {
      tasks: stored?.tasks ?? true,
      reminders: stored?.reminders ?? true,
      calendar: stored?.calendar ?? true,
      mail: stored?.mail ?? true,
    };
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const on = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
    calendar: sourceOn(settings, "calendar"),
    mail: sourceOn(settings, "mail"),
  };
  const visible = {
    tasks: on.tasks && layers.tasks && !search.eventsOnly,
    reminders: on.reminders && layers.reminders && !search.eventsOnly,
    calendar: on.calendar && layers.calendar,
    mail: on.mail && layers.mail && !search.eventsOnly,
  };
  const mailByDay = new Map<string, MailItem[]>();
  if (visible.mail)
    for (const message of messages) {
      const day = toISODate(new Date(message.date));
      mailByDay.set(day, [...(mailByDay.get(day) ?? []), message]);
    }
  // Keep full link membership while choosing the representative from visible sources.
  const todos = mergeLinkedTodos(allTodos, planning.data?.duplicateLinks, visible);
  const agenda = buildAgenda({
    events,
    todos,
    startDate,
    days,
    now,
    search: search.q,
    sources: visible,
  });
  const focusKeys = planning.data?.focusKeys ?? [];
  const focusTodos = todos.filter(
    (todo) =>
      !todo.completed && (todo.linkedKeys ?? [todo.key]).some((key) => focusKeys.includes(key)),
  );
  const selectedTodo = allTodos.find((todo) => todo.key === search.item);
  const selectedEvent = selectedTodo ? undefined : selectedCalendarEvent(events, search.item);
  const selectedMail = messages.find((message) => message.id === selectedMailId);
  const detailView = settings?.general.detailView ?? "dialog";
  const allReady =
    (!on.tasks || !tasks.isPending) &&
    (!on.reminders || !reminders.isPending) &&
    (!on.calendar || !calendar.isPending);
  const healthy =
    (!on.tasks || tasks.data?.state === "ok") &&
    (!on.reminders || reminders.data?.state === "ok") &&
    (!on.calendar || calendar.data?.state === "ok");
  const dueToday = todos.filter((todo) => !todo.completed && todo.dueDate === today).length;
  const todayEvents = buildAgenda({
    events,
    todos: [],
    startDate: today,
    days: 1,
    now,
  }).days[0];
  const remaining = [
    ...todayEvents.allDay,
    ...todayEvents.timed.flatMap((item) =>
      item.kind === "event" && new Date(item.event.end) > now ? [item.event] : [],
    ),
  ];
  const next = remaining.find((event) => !event.allDay);
  const summary = [
    on.tasks || on.reminders ? `${dueToday} due today` : null,
    on.calendar && startDate === today
      ? `${remaining.length} event${remaining.length === 1 ? "" : "s"}${next ? ` · next ${formatTimeOfDay(next.start)}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function updateSearch(patch: Partial<AgendaSearch>) {
    void navigate({
      to: calendarRoute ? "/calendar" : "/",
      search: {
        span,
        date: search.date,
        q: search.q,
        item: search.item,
        eventsOnly: search.eventsOnly,
        view: search.view,
        ...patch,
      },
      replace: true,
    });
  }
  function pin(todo: Todo) {
    if (!planning.data || planning.setFocus.isPending) return;
    const members = todo.linkedKeys ?? [todo.key];
    const focused = members.some((key) => focusKeys.includes(key));
    if (!focused && focusKeys.length >= 3) {
      toast.info("Choose up to three focus items. Unpin one first.");
      return;
    }
    planning.setFocus.mutate({
      focusKeys: focused
        ? focusKeys.filter((key) => !members.includes(key))
        : [...focusKeys, todo.key],
    });
  }
  const listProps = {
    now,
    focusKeys,
    onOpen: (todo: Todo) => toggleDetail(todo.key),
    onOpenEvent: (_event: CalendarEventItem, key: string) => toggleDetail(key),
    onPin: pin,
    expandedKey: detailView === "inline" ? search.item : undefined,
    renderExpanded: detailView === "inline" ? () => renderDetail("panel") : undefined,
  };
  function toggleDetail(key: string) {
    setSelectedMailId(undefined);
    updateSearch({ item: search.item === key ? undefined : key });
  }
  function toggleMail(message: MailItem) {
    updateSearch({ item: undefined });
    setSelectedMailId((current) => (current === message.id ? undefined : message.id));
  }
  function renderMailDetail(presentation: "dialog" | "panel") {
    if (!selectedMail) return null;
    return (
      <MailDetail
        key={selectedMail.id}
        message={selectedMail}
        triage={featureOn(settings, "triage") ? triage.map[selectedMail.id] : undefined}
        presentation={presentation}
        onClose={() => setSelectedMailId(undefined)}
        onReply={setReplyTo}
      />
    );
  }
  function renderDetail(presentation: "dialog" | "panel") {
    const close = () => updateSearch({ item: undefined });
    if (selectedTodo)
      return (
        <AgendaDetailDialog
          key={selectedTodo.key}
          todo={selectedTodo}
          todos={allTodos}
          events={events}
          messages={messages}
          date={
            selectedTodo.dueDate && selectedTodo.dueDate >= today
              ? selectedTodo.dueDate
              : startDate < today
                ? today
                : startDate
          }
          now={now}
          presentation={presentation}
          onClose={close}
        />
      );
    if (selectedEvent)
      return (
        <EventDetail
          key={calendarEventKey(selectedEvent)}
          event={selectedEvent}
          presentation={presentation}
          onClose={close}
        />
      );
    return null;
  }
  // Overdue sits at the top of today, or above the list when browsing other dates.
  const showOverdue = !search.eventsOnly && agenda.overdue.length > 0;
  const overdueDay = today;
  const overdueSummary = (
    <OverdueSummary count={agenda.overdue.length}>
      <AgendaList entries={agenda.overdue.map(todoEntry)} {...listProps} />
    </OverdueSummary>
  );
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f" &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const sourceQueries = [
    { source: "tasks" as const, query: tasks },
    { source: "reminders" as const, query: reminders },
    { source: "calendar" as const, query: calendar },
    { source: "mail" as const, query: mail },
  ].filter(({ source }) => on[source]);
  const unreviewed = messages.filter((message) => !triage.map[message.id]);
  const needsReply = messages.filter(
    (message) => triage.map[message.id]?.category === "needs-reply",
  );
  const triageOn = featureOn(settings, "triage");
  const attention = triageOn
    ? [...needsReply, ...unreviewed].slice(0, 3)
    : messages.filter((message) => message.unread).slice(0, 3);
  const searchTodos = todos.filter(
    (todo) =>
      !todo.completed &&
      visible[todo.source] &&
      `${todo.title} ${todo.notes ?? ""} ${todo.listTitle}`
        .toLocaleLowerCase()
        .includes(search.q?.trim().toLocaleLowerCase() ?? ""),
  );

  const sidePanel =
    detailView === "sidebar"
      ? selectedMail
        ? renderMailDetail("panel")
        : renderDetail("panel")
      : null;
  return (
    <>
      <div className="flex h-full min-w-0">
        <div className="h-full min-w-0 flex-1">
          <ScrollArea
            className="h-full"
            leading={<HistoryNav />}
            title="Agenda"
            subtitle={parseISODate(startDate).toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            actions={
              <ViewActions
                refreshing={sourceQueries.some(({ query }) => query.isFetching)}
                onRefresh={() => {
                  for (const { query } of sourceQueries) void query.refetch();
                }}
              />
            }
          >
            <div className="flex flex-col gap-[var(--density-page-gap)] px-6 pb-8 pt-1 w-full max-w-5xl mx-auto">
              <div className="flex flex-wrap items-center gap-2">
                {modeSwitch}
                {calendarRoute ? (
                  <Select
                    value={span === "week" ? "next-7-days" : span}
                    onValueChange={(value) =>
                      updateSearch({ span: value as AgendaSpan, date: undefined })
                    }
                  >
                    <SelectTrigger size="small" aria-label="Calendar range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CALENDAR_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <SegmentedControl
                    size="small"
                    allowEmpty
                    value={
                      span === "today"
                        ? "day"
                        : span === "week" || span === "next-7-days"
                          ? "week"
                          : ""
                    }
                    onValueChange={(value) =>
                      updateSearch({
                        span: value === "week" ? "week" : "today",
                        date: undefined,
                      })
                    }
                    aria-label="Agenda range"
                  >
                    <SegmentedControlItem value="day">Today</SegmentedControlItem>
                    <SegmentedControlItem value="week">Next 7 days</SegmentedControlItem>
                  </SegmentedControl>
                )}
                <Button
                  iconOnly
                  size="small"
                  variant="transparent"
                  aria-label="Previous date"
                  onClick={() => updateSearch({ date: addDays(startDate, -days) })}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  iconOnly
                  size="small"
                  variant="transparent"
                  aria-label="Next date"
                  onClick={() => updateSearch({ date: addDays(startDate, days) })}
                >
                  <ChevronRight />
                </Button>
                {startDate !== today ? (
                  <Button size="small" onClick={() => updateSearch({ date: undefined })}>
                    Today
                  </Button>
                ) : null}
                <div className="flex items-center gap-2 flex-1 min-w-40">
                  <Search className="size-4 text-tertiary shrink-0" />
                  <Input
                    ref={inputRef}
                    size="small"
                    aria-label="Search agenda"
                    placeholder="Search tasks, notes, events…"
                    value={search.q ?? ""}
                    onChange={(event) => updateSearch({ q: event.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {(["tasks", "reminders", "calendar", "mail"] as const)
                  .filter((source) => on[source])
                  .map((source) => (
                    <label key={source} className="flex items-center gap-1.5 text-small">
                      <Checkbox
                        checked={visible[source]}
                        aria-label={`Show ${SOURCE_META[source].label}`}
                        onCheckedChange={(checked) => {
                          const nextLayers = {
                            ...layers,
                            [source]: checked === true,
                          };
                          setLayers(nextLayers);
                          writeStored(LAYERS_KEY, nextLayers);
                          if (source !== "calendar" && checked === true && search.eventsOnly)
                            updateSearch({ eventsOnly: undefined });
                        }}
                      />
                      <SourceIcon source={source} />
                      {SOURCE_META[source].label}
                    </label>
                  ))}
                {featureOn(settings, "prioritize") ? (
                  <Button
                    size="small"
                    variant="transparent"
                    onClick={() => setPrioritize(true)}
                    disabled={!todos.some((todo) => !todo.completed)}
                  >
                    <Sparkles />
                    Suggest focus
                  </Button>
                ) : null}
              </div>
              <AgendaSourceStatus
                sources={sourceQueries}
                refreshMinutes={settings?.general.refreshMinutes ?? 0}
              />
              {!sourceQueries.length ? (
                <Callout
                  actions={
                    <Button size="small" onClick={() => void openSettings()}>
                      Settings
                    </Button>
                  }
                >
                  Turn on a source to build your agenda.
                </Callout>
              ) : null}
              {planning.isError ? (
                <Callout color="orange">
                  Focus and item links could not be loaded. Your source items are still available.
                </Callout>
              ) : null}
              {!search.q && !calendarRoute && startDate === today ? (
                <>
                  {featureOn(settings, "briefing") ? (
                    <BriefingCard
                      summary={
                        allReady
                          ? `${healthy ? "" : "Loaded sources · "}${summary || "Your day at a glance"}`
                          : "Loading your day…"
                      }
                      ready={allReady && !mail.isPending}
                      autoGenerate={featureOn(settings, "autoBriefing") && startDate === today}
                      buildPrompt={() =>
                        buildBriefingPrompt({
                          todos,
                          todosAvailable:
                            tasks.data?.state === "ok" || reminders.data?.state === "ok",
                          calendar: calendar.data,
                          mail: mail.data,
                          triage: triage.map,
                        })
                      }
                    />
                  ) : (
                    <Text color="secondary">{summary}</Text>
                  )}
                  {featureOn(settings, "assistant") ? (
                    <AskAssistantCard provider={settings?.ai.provider ?? "glaze"} />
                  ) : null}
                </>
              ) : null}
              {!allReady && !todos.length && !events.length ? <RowsSkeleton rows={4} /> : null}
              {search.q ? (
                <SectionCard title={`Search results · ${searchTodos.length} tasks`}>
                  <Text variant="small" color="tertiary">
                    All loaded open tasks; events within the selected dates.
                  </Text>
                  <AgendaList
                    entries={[
                      ...agenda.days
                        .flatMap((day) => [
                          ...day.allDay.map(eventEntry),
                          ...day.timed.filter((entry) => entry.kind === "event"),
                        ])
                        .filter(
                          (entry, index, all) =>
                            all.findIndex((other) => other.key === entry.key) === index,
                        ),
                      ...searchTodos.map(todoEntry),
                    ]}
                    {...listProps}
                  />
                  {!searchTodos.length &&
                  !agenda.days.some((day) => day.allDay.length || day.timed.length) ? (
                    <InlineHint>No matching items in loaded sources.</InlineHint>
                  ) : null}
                </SectionCard>
              ) : (
                <>
                  {focusTodos.length ? (
                    <SectionCard
                      title="Focus"
                      accessory={
                        <Text variant="small" color="tertiary">
                          Chosen by you
                        </Text>
                      }
                    >
                      <AgendaList entries={focusTodos.map(todoEntry)} {...listProps} />
                    </SectionCard>
                  ) : null}
                  {showOverdue && !agenda.days.some((day) => day.date === overdueDay)
                    ? overdueSummary
                    : null}
                  {agenda.days.map((day) => {
                    const earlier = day.timed.filter(
                      (entry) => entry.kind === "event" && new Date(entry.event.end) <= now,
                    );
                    const active = day.timed.filter(
                      (entry) => entry.kind !== "event" || new Date(entry.event.end) > now,
                    );
                    const empty = !day.allDay.length && !active.length && !day.anytime.length;
                    const entries = [
                      ...day.allDay.map(eventEntry),
                      ...active,
                      ...day.anytime.map(todoEntry),
                    ];
                    return (
                      <SectionCard key={day.date} title={dayHeading(day.date)}>
                        {showOverdue && day.date === overdueDay ? overdueSummary : null}
                        {entries.length ? <AgendaList entries={entries} {...listProps} /> : null}
                        {mailByDay.get(day.date)?.length ? (
                          <MailDigest messages={mailByDay.get(day.date)!}>
                            <ListCard>
                              {mailByDay.get(day.date)!.map((message) => (
                                <div key={message.id}>
                                  <MailRow
                                    message={message}
                                    triage={
                                      featureOn(settings, "triage")
                                        ? triage.map[message.id]
                                        : undefined
                                    }
                                    onReply={setReplyTo}
                                    onOpen={toggleMail}
                                    selected={selectedMailId === message.id}
                                    compact
                                  />
                                  {detailView === "inline" && selectedMailId === message.id
                                    ? renderMailDetail("panel")
                                    : null}
                                </div>
                              ))}
                            </ListCard>
                          </MailDigest>
                        ) : null}
                        {empty && !mailByDay.get(day.date)?.length && allReady ? (
                          <InlineHint>
                            {healthy
                              ? "Nothing scheduled or due in the selected sources."
                              : "No items in the available sources."}
                          </InlineHint>
                        ) : null}
                        {earlier.length ? (
                          <Disclosure title="Earlier" count={earlier.length}>
                            <AgendaList entries={earlier} {...listProps} />
                          </Disclosure>
                        ) : null}
                      </SectionCard>
                    );
                  })}
                  {!search.eventsOnly ? (
                    <div className="border-t border-separator pt-2 flex flex-col gap-2">
                      <Disclosure title="No date" count={agenda.undated.length}>
                        <AgendaList entries={agenda.undated.map(todoEntry)} {...listProps} />
                      </Disclosure>
                    </div>
                  ) : null}
                </>
              )}
              {!search.q && visible.mail && !calendarRoute ? (
                <SectionCard
                  title="Needs attention"
                  accessory={
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => void navigate({ to: "/mail" })}
                    >
                      Inbox
                    </Button>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Text variant="small" color="secondary">
                      {triageOn
                        ? `${needsReply.length} need a reply · ${unreviewed.length} unreviewed`
                        : `${messages.filter((item) => item.unread).length} unread in ${messages.length} loaded messages`}
                    </Text>
                    {triageOn ? (
                      <Button
                        size="small"
                        onClick={triage.isRunning ? triage.stop : triage.run}
                        disabled={!messages.length}
                      >
                        {triage.isRunning ? "Stop" : "Review inbox"}
                      </Button>
                    ) : null}
                  </div>
                  {triage.message ? <Callout color="orange">{triage.message}</Callout> : null}
                  {triage.parseFailed ? (
                    <Callout color="orange">The inbox review could not be read. Try again.</Callout>
                  ) : null}
                  {attention.length ? (
                    <ListCard>
                      {attention.map((message) => (
                        <div key={message.id}>
                          <MailRow
                            message={message}
                            triage={triageOn ? triage.map[message.id] : undefined}
                            onReply={setReplyTo}
                            onOpen={toggleMail}
                            selected={selectedMailId === message.id}
                            compact
                          />
                          {detailView === "inline" && selectedMailId === message.id
                            ? renderMailDetail("panel")
                            : null}
                        </div>
                      ))}
                    </ListCard>
                  ) : (
                    <InlineHint>
                      {mail.data?.state === "ok"
                        ? "No attention items in the loaded messages."
                        : "Inbox is unavailable."}
                    </InlineHint>
                  )}
                </SectionCard>
              ) : null}
            </div>
          </ScrollArea>
        </div>
        {sidePanel ? (
          <aside
            aria-label="Details"
            className="h-full w-[min(380px,40%)] shrink-0 overflow-y-auto border-l border-separator px-3 pb-6 pt-14"
          >
            {sidePanel}
          </aside>
        ) : null}
      </div>
      {detailView === "dialog" ? renderDetail("dialog") : null}
      {detailView === "dialog" ? renderMailDetail("dialog") : null}
      <ReplyDialog
        key={replyTo?.id ?? "none"}
        message={replyTo}
        onOpenChange={(open) => !open && setReplyTo(null)}
      />
      <Dialog open={prioritize} onOpenChange={setPrioritize} title="Suggested focus" size="large">
        <UpNextCard
          todos={todos}
          todayEvents={events}
          sources={(["tasks", "reminders"] as SourceId[]).filter((source) => on[source])}
          loading={!allReady}
          hint={null}
          canPrioritize={featureOn(settings, "prioritize")}
          messages={messages}
          onChoose={(todo) => {
            setPrioritize(false);
            updateSearch({ item: todo.key });
          }}
        />
      </Dialog>
    </>
  );
}
