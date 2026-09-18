import { useState } from "react";
import { Checkbox, EmptyState, ScrollArea, Text } from "@glaze/core/components";
import type { CalendarEventItem } from "@main/shared-types";

import { EventRow } from "../components/event-row";
import { ListCard, SectionCard } from "../components/section-card";
import { SourceDot, SourceHeading } from "../components/source-dot";
import { SourceGate } from "../components/source-gate";
import { ViewActions } from "../components/view-actions";
import { addDays, dayHeading, eventDayKey, formatClock, shortDate, todayISO } from "../lib/dates";
import { useCalendar, useReminders, useTasks, useToggleTodo } from "../lib/queries";
import { sourceOn, useSettings } from "../lib/settings";
import { SOURCE_META } from "../lib/sources";
import { readStored, writeStored } from "../lib/storage";
import { buildTodos, compareByDue, type Todo } from "../lib/todos";

const LAYERS_KEY = "dashboard:calendarLayers:v1";
const OVERDUE = "overdue";

type Layers = Record<Todo["source"], boolean>;

function isLayers(value: unknown): value is Layers {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.tasks === "boolean" && typeof v.reminders === "boolean";
}

function useLayers(): [Layers, (source: Todo["source"], visible: boolean) => void] {
  const [layers, setLayers] = useState<Layers>(() => readStored(LAYERS_KEY, isLayers) ?? { tasks: true, reminders: true });
  const setLayer = (source: Todo["source"], visible: boolean) => {
    const next = { ...layers, [source]: visible };
    setLayers(next);
    writeStored(LAYERS_KEY, next);
  };
  return [layers, setLayer];
}

type AgendaItem = { kind: "event"; event: CalendarEventItem } | { kind: "todo"; todo: Todo };

/** All-day events and untimed to-dos first, then everything with a time in order. */
function sortKey(item: AgendaItem): string {
  if (item.kind === "event") {
    const { event } = item;
    return event.allDay ? `0 ${event.title}` : `1 ${new Date(event.start).toTimeString().slice(0, 5)} 0`;
  }
  const { todo } = item;
  return todo.dueTime ? `1 ${todo.dueTime} 1 ${todo.title}` : `0 ~${todo.title}`;
}

function buildAgenda(events: CalendarEventItem[], todos: Todo[], lastDay: string): [string, AgendaItem[]][] {
  const today = todayISO();
  const groups = new Map<string, AgendaItem[]>();
  const add = (day: string, item: AgendaItem) => groups.set(day, [...(groups.get(day) ?? []), item]);

  for (const event of events) add(eventDayKey(event), { kind: "event", event });
  for (const todo of todos) {
    if (!todo.dueDate || todo.completed || todo.dueDate > lastDay) continue;
    add(todo.dueDate < today ? OVERDUE : todo.dueDate, { kind: "todo", todo });
  }

  return [...groups]
    .map(([day, items]): [string, AgendaItem[]] => [
      day,
      day === OVERDUE
        ? items.sort((a, b) => (a.kind === "todo" && b.kind === "todo" ? compareByDue(a.todo, b.todo) : 0))
        : items.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    ])
    .sort(([a], [b]) => (a === OVERDUE ? -1 : b === OVERDUE ? 1 : a.localeCompare(b)));
}

function AgendaTodoRow({ todo, overdue }: { todo: Todo; overdue: boolean }) {
  const toggle = useToggleTodo();
  const when = overdue && todo.dueDate ? shortDate(todo.dueDate) : todo.dueTime ? formatClock(todo.dueTime) : "Anytime";

  return (
    <div className="flex items-center gap-3 px-3 py-2 min-h-12 min-w-0">
      <SourceDot source={todo.source} />
      <Text
        variant="small"
        color={overdue ? undefined : "secondary"}
        className={overdue ? "w-32 shrink-0 tabular-nums text-support-red" : "w-32 shrink-0 tabular-nums"}
      >
        {when}
      </Text>
      <Checkbox
        checked={todo.completed}
        onCheckedChange={() => toggle.mutate(todo)}
        aria-label={todo.completed ? `Mark “${todo.title}” incomplete` : `Complete “${todo.title}”`}
      />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <Text truncate color={todo.completed ? "tertiary" : "primary"} className={todo.completed ? "line-through" : undefined}>
          {todo.title}
        </Text>
        <Text variant="small" color="tertiary" truncate>
          {[SOURCE_META[todo.source].label, todo.listTitle].filter(Boolean).join(" · ")}
        </Text>
      </div>
    </div>
  );
}

function CalendarLegend({
  events,
  layerSources,
  layers,
  onLayerChange,
}: {
  events: CalendarEventItem[];
  layerSources: Todo["source"][];
  layers: Layers;
  onLayerChange: (source: Todo["source"], visible: boolean) => void;
}) {
  const calendars = [...new Map(events.map((event) => [event.calendarId, event])).values()];
  const showCalendars = calendars.length >= 2;
  if (!showCalendars && !layerSources.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
      {showCalendars
        ? calendars.map((event) => (
            <span key={event.calendarId} className="flex items-center gap-1.5 min-w-0">
              {event.calendarColor ? (
                <span
                  aria-hidden="true"
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: event.calendarColor }}
                />
              ) : (
                <SourceDot source="calendar" />
              )}
              <Text variant="small" color="secondary" truncate>
                {event.calendarName}
              </Text>
            </span>
          ))
        : null}
      {layerSources.length ? (
        <div className="flex items-center gap-4 ms-auto">
          <Text variant="small" color="tertiary">
            Show
          </Text>
          {layerSources.map((source) => (
            <label key={source} className="flex items-center gap-1.5 cursor-default">
              <Checkbox checked={layers[source]} onCheckedChange={(checked) => onLayerChange(source, checked === true)} />
              <SourceDot source={source} />
              <Text variant="small" color="secondary">
                {SOURCE_META[source].label}
              </Text>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CalendarView() {
  const calendar = useCalendar();
  const tasks = useTasks();
  const reminders = useReminders();
  const settings = useSettings().data;
  const daysAhead = settings?.calendar.daysAhead ?? 7;
  const [layers, setLayer] = useLayers();

  const layerSources = (["tasks", "reminders"] as const).filter((source) => sourceOn(settings, source));
  const todos = buildTodos(
    layers.tasks ? tasks.data : undefined,
    layers.reminders ? reminders.data : undefined,
  );
  const lastDay = addDays(todayISO(), daysAhead - 1);

  const refresh = () => {
    void calendar.refetch();
    if (layerSources.includes("tasks")) void tasks.refetch();
    if (layerSources.includes("reminders")) void reminders.refetch();
  };

  return (
    <ScrollArea
      className="h-full"
      title={<SourceHeading source="calendar" />}
      subtitle={`Next ${daysAhead} days`}
      actions={
        <ViewActions
          onRefresh={refresh}
          refreshing={calendar.isFetching || tasks.isFetching || reminders.isFetching}
        />
      }
    >
      <div className="flex flex-col gap-6 px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
        <SourceGate query={calendar} label="Google Calendar">
          {(events) => {
            const multiple = new Set(events.map((event) => event.calendarId)).size > 1;
            const agenda = buildAgenda(events, todos, lastDay);
            return (
              <>
                <CalendarLegend events={events} layerSources={layerSources} layers={layers} onLayerChange={setLayer} />
                {agenda.length ? (
                  agenda.map(([day, items]) => (
                    <SectionCard key={day} title={day === OVERDUE ? "Overdue" : dayHeading(day)}>
                      <ListCard>
                        {items.map((item) =>
                          item.kind === "event" ? (
                            <EventRow key={item.event.id} event={item.event} dot="calendar" showCalendar={multiple} />
                          ) : (
                            <AgendaTodoRow key={item.todo.key} todo={item.todo} overdue={day === OVERDUE} />
                          ),
                        )}
                      </ListCard>
                    </SectionCard>
                  ))
                ) : (
                  <EmptyState
                    placement="viewport"
                    title="A Clear Stretch"
                    description={`Nothing scheduled or due for the next ${daysAhead} days.`}
                  />
                )}
              </>
            );
          }}
        </SourceGate>
      </div>
    </ScrollArea>
  );
}
