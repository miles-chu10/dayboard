import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button, ScrollArea, SegmentedControl, SegmentedControlItem, Text } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { ChevronLeft, ChevronRight, Circle } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { AgendaDetailDialog } from "../components/agenda-detail-dialog";
import { AgendaList, eventEntry, todoEntry } from "../components/agenda-list";
import { EventDetail } from "../components/event-detail";
import {
  calendarEventKey as eventKey,
  identifyCalendarEvents,
  selectedCalendarEvent,
} from "../lib/calendar-identity";
import { HistoryNav } from "../components/history-nav";
import { ViewActions } from "../components/view-actions";
import type { AgendaSearch, CalendarLayout } from "../lib/agenda-search";
import { addDays, formatTimeOfDay, parseISODate, toISODate } from "../lib/dates";
import { useAgendaState, useCalendarRange, useMail, useReminders, useTasks } from "../lib/queries";
import { sourceOn, useSettings } from "../lib/settings";
import { COLOR_CLASS, sourceColor, sourceColorVar } from "../lib/sources";
import { buildTodos, mergeLinkedTodos, type Todo } from "../lib/todos";
import { useAgendaClock } from "../lib/use-agenda-clock";
import { AgendaView } from "./agenda-view";

const MONTH_ITEMS = 3;

function ModeSwitch({
  value,
  onChange,
}: {
  value: CalendarLayout;
  onChange: (value: CalendarLayout) => void;
}) {
  return (
    <SegmentedControl
      size="small"
      value={value}
      onValueChange={(next: string) => next && onChange(next as CalendarLayout)}
      aria-label="Calendar layout"
    >
      <SegmentedControlItem value="month">Month</SegmentedControlItem>
      <SegmentedControlItem value="week">Week</SegmentedControlItem>
      <SegmentedControlItem value="schedule">Schedule</SegmentedControlItem>
    </SegmentedControl>
  );
}

export function CalendarView() {
  const search = useSearch({ from: "/calendar" });
  const navigate = useNavigate();
  const view = search.view ?? "month";
  const switchTo = (next: CalendarLayout) =>
    void navigate({
      to: "/calendar",
      search: { date: search.date, view: next === "month" ? undefined : next },
    });
  if (view === "schedule")
    return (
      <AgendaView calendarRoute modeSwitch={<ModeSwitch value="schedule" onChange={switchTo} />} />
    );
  return <CalendarGrid view={view} search={search} onSwitch={switchTo} />;
}

// ── Grid data ──────────────────────────────────────────────────────────────────────────

interface DayItems {
  allDay: CalendarEventItem[];
  timed: CalendarEventItem[];
  todos: Todo[];
}

function startOfWeek(iso: string): string {
  return addDays(iso, -parseISODate(iso).getDay());
}

/** Local dates an event covers (all-day end dates are exclusive). */
function eventDays(event: CalendarEventItem): string[] {
  if (event.allDay) {
    const days: string[] = [];
    const end = event.end.slice(0, 10);
    for (let day = event.start.slice(0, 10); day < end && days.length < 62; day = addDays(day, 1))
      days.push(day);
    return days.length ? days : [event.start.slice(0, 10)];
  }
  const start = toISODate(new Date(event.start));
  // An event ending exactly at midnight doesn't occupy the next day.
  const end = toISODate(new Date(new Date(event.end).getTime() - 1));
  const days: string[] = [];
  for (let day = start; day <= end && days.length < 62; day = addDays(day, 1)) days.push(day);
  return days;
}

function groupByDay(events: CalendarEventItem[], todos: Todo[], dates: string[]) {
  const map = new Map<string, DayItems>(
    dates.map((date) => [date, { allDay: [], timed: [], todos: [] }]),
  );
  for (const event of events)
    for (const day of eventDays(event)) {
      const bucket = map.get(day);
      if (bucket) (event.allDay ? bucket.allDay : bucket.timed).push(event);
    }
  for (const todo of todos) if (todo.dueDate) map.get(todo.dueDate)?.todos.push(todo);
  for (const bucket of map.values()) {
    bucket.timed.sort((a, b) => a.start.localeCompare(b.start));
    bucket.todos.sort((a, b) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99"));
  }
  return map;
}

function CalendarGrid({
  view,
  search,
  onSwitch,
}: {
  view: "month" | "week";
  search: AgendaSearch;
  onSwitch: (view: CalendarLayout) => void;
}) {
  const now = useAgendaClock();
  const today = toISODate(now);
  const navigate = useNavigate();
  const settings = useSettings().data;
  const selected = search.date ?? today;
  const anchor = parseISODate(selected);
  const monthStart = toISODate(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const rangeStart = view === "month" ? startOfWeek(monthStart) : startOfWeek(selected);
  const days = view === "month" ? 42 : 7;
  const dates = Array.from({ length: days }, (_, index) => addDays(rangeStart, index));

  const calendar = useCalendarRange(rangeStart, days);
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const planning = useAgendaState();
  const events = useMemo(
    () => identifyCalendarEvents(calendar.data?.state === "ok" ? calendar.data.items : []),
    [calendar.data],
  );
  const allTodos = buildTodos(tasks.data, reminders.data);
  const visible = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
  };
  const todos = mergeLinkedTodos(allTodos, planning.data?.duplicateLinks, visible).filter(
    (todo) => !todo.completed && visible[todo.source],
  );
  const byDay = groupByDay(sourceOn(settings, "calendar") ? events : [], todos, dates);
  const messages = mail.data?.state === "ok" ? mail.data.items : [];
  const detailView = settings?.general.detailView ?? "dialog";

  function update(patch: Partial<AgendaSearch>) {
    void navigate({
      to: "/calendar",
      search: { view: search.view, date: search.date, item: search.item, ...patch },
      replace: true,
    });
  }
  function shift(direction: -1 | 1) {
    const next =
      view === "month"
        ? toISODate(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1))
        : addDays(selected, direction * 7);
    update({ date: next === today ? undefined : next, item: undefined });
  }
  const openItem = (key: string) => update({ item: search.item === key ? undefined : key });

  const selectedTodo = allTodos.find((todo) => todo.key === search.item);
  const selectedEvent = selectedTodo ? undefined : selectedCalendarEvent(events, search.item);
  function renderDetail(presentation: "dialog" | "panel") {
    const close = () => update({ item: undefined });
    if (selectedTodo)
      return (
        <AgendaDetailDialog
          key={selectedTodo.key}
          todo={selectedTodo}
          todos={allTodos}
          events={events}
          messages={messages}
          date={
            selectedTodo.dueDate && selectedTodo.dueDate >= today ? selectedTodo.dueDate : today
          }
          now={now}
          presentation={presentation}
          onClose={close}
        />
      );
    if (selectedEvent)
      return (
        <EventDetail
          key={eventKey(selectedEvent)}
          event={selectedEvent}
          presentation={presentation}
          onClose={close}
        />
      );
    return null;
  }

  const title =
    view === "month"
      ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
      : `${parseISODate(dates[0]).toLocaleDateString([], { month: "short", day: "numeric" })} – ${parseISODate(dates[6]).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  const panelDetail = detailView !== "dialog" ? renderDetail("panel") : null;
  const selectedItems = byDay.get(selected);

  return (
    <>
      <div className="flex h-full min-w-0">
        <div className="h-full min-w-0 flex-1">
          <ScrollArea
            className="h-full"
            leading={<HistoryNav />}
            title="Calendar"
            subtitle={title}
            actions={
              <ViewActions
                refreshing={calendar.isFetching || tasks.isFetching || reminders.isFetching}
                onRefresh={() => {
                  void calendar.refetch();
                  void tasks.refetch();
                  void reminders.refetch();
                }}
              />
            }
          >
            <div className="flex flex-col gap-[var(--density-page-gap)] px-6 pb-8 pt-2 w-full">
              <div className="flex flex-wrap items-center gap-2">
                <ModeSwitch value={view} onChange={onSwitch} />
                <Button size="small" onClick={() => update({ date: undefined, item: undefined })}>
                  Today
                </Button>
                <Button
                  size="small"
                  variant="transparent"
                  iconOnly
                  aria-label={view === "month" ? "Previous month" : "Previous week"}
                  onClick={() => shift(-1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  size="small"
                  variant="transparent"
                  iconOnly
                  aria-label={view === "month" ? "Next month" : "Next week"}
                  onClick={() => shift(1)}
                >
                  <ChevronRight />
                </Button>
                <Text variant="large-strong" as="h2">
                  {title}
                </Text>
              </div>
              {view === "month" ? (
                <MonthGrid
                  dates={dates}
                  month={anchor.getMonth()}
                  today={today}
                  selected={selected}
                  byDay={byDay}
                  onSelect={(date) => update({ date: date === today ? undefined : date })}
                  onOpen={openItem}
                />
              ) : (
                <WeekGrid dates={dates} today={today} now={now} byDay={byDay} onOpen={openItem} />
              )}
            </div>
          </ScrollArea>
        </div>
        {view === "month" || panelDetail ? (
          <aside
            aria-label={panelDetail ? "Details" : "Selected day"}
            className="h-full w-[min(360px,36%)] shrink-0 overflow-y-auto border-l border-separator px-3 pb-6 pt-14"
          >
            {panelDetail ?? (
              <div className="flex flex-col gap-3">
                <Text variant="large-strong" as="h2">
                  {parseISODate(selected).toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </Text>
                {selectedItems &&
                (selectedItems.allDay.length ||
                  selectedItems.timed.length ||
                  selectedItems.todos.length) ? (
                  <AgendaList
                    entries={[
                      ...selectedItems.allDay.map(eventEntry),
                      ...selectedItems.timed.map(eventEntry),
                      ...selectedItems.todos.map(todoEntry),
                    ]}
                    now={now}
                    focusKeys={planning.data?.focusKeys ?? []}
                    onOpen={(todo) => openItem(todo.key)}
                    onOpenEvent={(event) => openItem(eventKey(event))}
                    onPin={() => undefined}
                  />
                ) : (
                  <Text color="tertiary">Nothing scheduled or due.</Text>
                )}
              </div>
            )}
          </aside>
        ) : null}
      </div>
      {detailView === "dialog" ? renderDetail("dialog") : null}
    </>
  );
}

// ── Month ─────────────────────────────────────────────────────────────────────────────────

function useEventColor() {
  const settings = useSettings().data;
  return (event: CalendarEventItem) =>
    event.calendarColor ?? sourceColorVar(sourceColor(settings, "calendar"));
}

function Chip({
  label,
  onOpen,
  className,
  style,
  children,
}: {
  label: string;
  onOpen: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={cn(
        "flex h-5 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-small hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
      style={style}
    >
      {children}
    </button>
  );
}

function MonthGrid({
  dates,
  month,
  today,
  selected,
  byDay,
  onSelect,
  onOpen,
}: {
  dates: string[];
  month: number;
  today: string;
  selected: string;
  byDay: Map<string, DayItems>;
  onSelect: (date: string) => void;
  onOpen: (key: string) => void;
}) {
  const settings = useSettings().data;
  const colorOf = useEventColor();
  return (
    <div className="overflow-hidden rounded-lg border border-separator">
      <div className="grid grid-cols-7 border-b border-separator bg-well">
        {dates.slice(0, 7).map((date) => (
          <Text key={date} variant="small" color="secondary" className="px-2 py-1 text-center">
            {parseISODate(date).toLocaleDateString([], { weekday: "short" })}
          </Text>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid" aria-label="Month">
        {dates.map((date, index) => {
          const items = byDay.get(date)!;
          const all = [
            ...items.allDay.map((event) => ({ kind: "allDay" as const, event })),
            ...items.timed.map((event) => ({ kind: "timed" as const, event })),
            ...items.todos.map((todo) => ({ kind: "todo" as const, todo })),
          ];
          const shown = all.slice(0, MONTH_ITEMS);
          const inMonth = parseISODate(date).getMonth() === month;
          const day = parseISODate(date).getDate();
          return (
            <div
              key={date}
              role="gridcell"
              aria-selected={date === selected}
              tabIndex={0}
              onClick={() => onSelect(date)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(date);
                }
              }}
              className={cn(
                "flex min-h-[var(--calendar-cell)] min-w-0 cursor-default flex-col gap-0.5 p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                index % 7 !== 6 && "border-r border-separator",
                index < dates.length - 7 && "border-b border-separator",
                date === selected && "bg-accent-5",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center self-start rounded-full text-small tabular-nums",
                  date === today
                    ? "bg-accent font-semibold text-accent-contrast"
                    : inMonth
                      ? "text-primary"
                      : "text-quaternary",
                )}
              >
                {day}
              </span>
              {shown.map((item) =>
                item.kind === "todo" ? (
                  <Chip
                    key={item.todo.key}
                    label={item.todo.title}
                    onOpen={() => onOpen(item.todo.key)}
                  >
                    <Circle
                      aria-hidden="true"
                      className={cn(
                        "size-2.5 shrink-0",
                        COLOR_CLASS[sourceColor(settings, item.todo.source)].text,
                      )}
                    />
                    <span className={cn("truncate", !inMonth && "text-tertiary")}>
                      {item.todo.title}
                    </span>
                  </Chip>
                ) : item.kind === "allDay" ? (
                  <Chip
                    key={eventKey(item.event)}
                    label={`${item.event.title}, all day`}
                    onOpen={() => onOpen(eventKey(item.event))}
                    className="font-medium"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${colorOf(item.event)} 22%, transparent)`,
                    }}
                  >
                    <span className="truncate">{item.event.title}</span>
                  </Chip>
                ) : (
                  <Chip
                    key={eventKey(item.event)}
                    label={`${item.event.title}, ${formatTimeOfDay(item.event.start)}`}
                    onOpen={() => onOpen(eventKey(item.event))}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(item.event) }}
                    />
                    <span className="shrink-0 tabular-nums text-secondary">
                      {formatTimeOfDay(item.event.start).replace(/:00(?=\s)/, "")}
                    </span>
                    <span className={cn("truncate", !inMonth && "text-tertiary")}>
                      {item.event.title}
                    </span>
                  </Chip>
                ),
              )}
              {all.length > MONTH_ITEMS ? (
                <Text variant="small" color="secondary" className="px-1">
                  {all.length - MONTH_ITEMS} more
                </Text>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week ──────────────────────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Places overlapping events side by side (greedy lanes per overlapping cluster). */
function layoutDay(events: CalendarEventItem[], date: string) {
  const dayStart = parseISODate(date).getTime();
  const dayEnd = dayStart + 86_400_000;
  const items = events
    .map((event) => {
      const start = Math.max(new Date(event.start).getTime(), dayStart);
      const end = Math.min(Math.max(new Date(event.end).getTime(), start + 15 * 60_000), dayEnd);
      return { event, start, end, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: typeof items = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1));
    for (const item of cluster) item.lanes = lanes;
    cluster = [];
  };
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) flush();
    const taken = new Set(
      cluster.filter((other) => other.end > item.start).map((other) => other.lane),
    );
    while (taken.has(item.lane)) item.lane++;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return items.map((item) => ({
    ...item,
    top: (item.start - dayStart) / 3_600_000,
    height: (item.end - item.start) / 3_600_000,
  }));
}

function WeekGrid({
  dates,
  today,
  now,
  byDay,
  onOpen,
}: {
  dates: string[];
  today: string;
  now: Date;
  byDay: Map<string, DayItems>;
  onOpen: (key: string) => void;
}) {
  const settings = useSettings().data;
  const colorOf = useEventColor();
  const morningRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    morningRef.current?.scrollIntoView({ block: "start" });
  }, []);
  const nowHours = now.getHours() + now.getMinutes() / 60;
  const hasTop = dates.some(
    (date) => byDay.get(date)!.allDay.length || byDay.get(date)!.todos.length,
  );

  return (
    <div className="overflow-hidden rounded-lg border border-separator">
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-separator bg-well">
        <span />
        {dates.map((date) => (
          <div key={date} className="flex items-center justify-center gap-1.5 py-1.5">
            <Text variant="small" color="secondary">
              {parseISODate(date).toLocaleDateString([], { weekday: "short" })}
            </Text>
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-small tabular-nums",
                date === today && "bg-accent font-semibold text-accent-contrast",
              )}
            >
              {parseISODate(date).getDate()}
            </span>
          </div>
        ))}
      </div>
      {hasTop ? (
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-separator">
          <Text variant="small" color="tertiary" className="px-1 py-1 text-right">
            All day
          </Text>
          {dates.map((date) => {
            const items = byDay.get(date)!;
            return (
              <div
                key={date}
                className="flex min-w-0 flex-col gap-0.5 border-l border-separator p-0.5"
              >
                {items.allDay.map((event) => (
                  <Chip
                    key={eventKey(event)}
                    label={`${event.title}, all day`}
                    onOpen={() => onOpen(eventKey(event))}
                    className="font-medium"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${colorOf(event)} 22%, transparent)`,
                    }}
                  >
                    <span className="truncate">{event.title}</span>
                  </Chip>
                ))}
                {items.todos.map((todo) => (
                  <Chip key={todo.key} label={todo.title} onOpen={() => onOpen(todo.key)}>
                    <Circle
                      aria-hidden="true"
                      className={cn(
                        "size-2.5 shrink-0",
                        COLOR_CLASS[sourceColor(settings, todo.source)].text,
                      )}
                    />
                    <span className="truncate">{todo.title}</span>
                  </Chip>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        <div>
          {HOURS.map((hour) => (
            <div
              key={hour}
              ref={hour === 7 ? morningRef : undefined}
              className="relative h-[var(--calendar-hour)] scroll-mt-16"
            >
              {hour ? (
                <Text
                  variant="small"
                  color="tertiary"
                  className="absolute -top-2 right-1.5 tabular-nums"
                >
                  {new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" })}
                </Text>
              ) : null}
            </div>
          ))}
        </div>
        {dates.map((date) => (
          <div key={date} className="relative border-l border-separator">
            {HOURS.map((hour) => (
              <div key={hour} className="h-[var(--calendar-hour)] border-b border-separator/60" />
            ))}
            {layoutDay(byDay.get(date)!.timed, date).map(({ event, top, height, lane, lanes }) => {
              const past = new Date(event.end) <= now;
              return (
                <button
                  key={eventKey(event)}
                  type="button"
                  onClick={() => onOpen(eventKey(event))}
                  aria-label={`${event.title}, ${formatTimeOfDay(event.start)} to ${formatTimeOfDay(event.end)}`}
                  className="absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-small focus-visible:outline-2 focus-visible:outline-accent"
                  style={{
                    top: `calc(${top} * var(--calendar-hour))`,
                    height: `calc(${height} * var(--calendar-hour) - 2px)`,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                    borderLeftColor: colorOf(event),
                    backgroundColor: `color-mix(in srgb, ${colorOf(event)} ${past ? 10 : 20}%, var(--db-background))`,
                    opacity: past ? 0.7 : 1,
                  }}
                >
                  <span className="block truncate font-medium">{event.title}</span>
                  {height >= 0.75 ? (
                    <span className="block truncate text-secondary tabular-nums">
                      {formatTimeOfDay(event.start)}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {date === today ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                style={{ top: `calc(${nowHours} * var(--calendar-hour))` }}
              >
                <span className="-ml-1 size-2 rounded-full bg-support-red" />
                <span className="h-px flex-1 bg-support-red" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
