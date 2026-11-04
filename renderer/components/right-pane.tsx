import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Button,
  ScrollArea,
  Text,
  Toolbar,
  ToolbarActions,
  ToolbarContent,
  ToolbarRow,
  ToolbarTitle,
} from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";

import { AssistantPanel } from "../main/assistant-view";
import { AgendaList, eventEntry, todoEntry } from "./agenda-list";
import { useShell } from "./shell";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { addDays, parseISODate, toISODate } from "../lib/dates";
import { groupByDay, startOfWeek } from "../lib/day-items";
import {
  toggleFocus,
  useAgendaState,
  useCalendarRange,
  useReminders,
  useTasks,
} from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { buildTodos, mergeLinkedTodos } from "../lib/todos";
import { useAgendaClock } from "../lib/use-agenda-clock";

/** Whatever the right pane should show here; null hides it. */
export function useRightPaneContent(): "agent" | "calendar" | null {
  const { rightPane } = useShell();
  const settings = useSettings().data;
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (rightPane === "agent")
    return featureOn(settings, "assistant") && pathname !== "/assistant" ? "agent" : null;
  if (rightPane === "calendar")
    return sourceOn(settings, "calendar") && pathname !== "/calendar" ? "calendar" : null;
  return null;
}

export function RightPane({ content }: { content: "agent" | "calendar" }) {
  return (
    <aside
      aria-label={content === "agent" ? "Assistant" : "Calendar"}
      className="h-full border-l border-separator bg-background"
    >
      {content === "agent" ? <AssistantPanel /> : <CalendarPeek />}
    </aside>
  );
}

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function CalendarPeek() {
  const { setRightPane } = useShell();
  const navigate = useNavigate();
  const settings = useSettings().data;
  const now = useAgendaClock();
  const today = toISODate(now);
  const [selected, setSelected] = useState(today);
  const weekStart = startOfWeek(selected);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const calendar = useCalendarRange(weekStart, 7);
  const tasks = useTasks();
  const reminders = useReminders();
  const planning = useAgendaState();
  const events = useMemo(
    () => identifyCalendarEvents(calendar.data?.state === "ok" ? calendar.data.items : []),
    [calendar.data],
  );
  const visible = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
  };
  const todos = mergeLinkedTodos(
    buildTodos(tasks.data, reminders.data),
    planning.data?.duplicateLinks,
    visible,
  ).filter((todo) => !todo.completed && visible[todo.source]);
  const day = groupByDay(events, todos, dates).get(selected)!;
  const entries = [
    ...day.allDay.map(eventEntry),
    ...day.timed.map(eventEntry),
    ...day.todos.map(todoEntry),
  ];
  const heading = parseISODate(selected).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <ScrollArea
      className="h-full"
      toolbar={
        <Toolbar inset="none">
          <ToolbarRow className="pl-4">
            <ToolbarContent>
              <ToolbarTitle as="h2">
                {heading}
                {selected === today ? (
                  <Text as="span" variant="small" color="secondary" className="ml-2">
                    Today
                  </Text>
                ) : null}
              </ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions>
              <Button
                iconOnly
                aria-label="Previous week"
                title="Previous week"
                onClick={() => setSelected(addDays(selected, -7))}
              >
                <ChevronLeft />
              </Button>
              <Button
                iconOnly
                aria-label="Next week"
                title="Next week"
                onClick={() => setSelected(addDays(selected, 7))}
              >
                <ChevronRight />
              </Button>
              <Button
                iconOnly
                aria-label="Open Calendar"
                title="Open Calendar"
                onClick={() =>
                  void navigate({
                    to: "/calendar",
                    search: { date: selected, view: "week" },
                  })
                }
              >
                <Maximize2 />
              </Button>
              <Button
                iconOnly
                aria-label="Close the calendar panel"
                title="Close (⌥⌘K)"
                onClick={() => setRightPane(null)}
              >
                <X />
              </Button>
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div role="group" aria-label="Days" className="grid grid-cols-7 gap-1">
          {dates.map((date) => {
            const isToday = date === today;
            const isSelected = date === selected;
            return (
              <button
                key={date}
                type="button"
                aria-pressed={isSelected}
                aria-label={parseISODate(date).toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
                onClick={() => setSelected(date)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg py-1 text-small",
                  "focus-visible:outline-2 focus-visible:outline-accent",
                  isSelected ? "bg-control text-primary" : "text-secondary hover:bg-control-subtle",
                )}
              >
                <span>{WEEKDAY[parseISODate(date).getDay()]}</span>
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full tabular-nums",
                    isToday && "bg-accent text-accent-contrast font-medium",
                  )}
                >
                  {parseISODate(date).getDate()}
                </span>
              </button>
            );
          })}
        </div>
        {calendar.isPending && !entries.length ? (
          <Text color="tertiary">Loading…</Text>
        ) : entries.length ? (
          <AgendaList
            entries={entries}
            now={now}
            focusKeys={planning.data?.focusKeys ?? []}
            onOpen={(todo) =>
              void navigate({
                to: "/",
                search: { date: selected, item: todo.key },
              })
            }
            onOpenEvent={(_event, key) =>
              void navigate({
                to: "/calendar",
                search: { date: selected, view: "week", item: key },
              })
            }
            onPin={(todo) => toggleFocus(planning, todo)}
          />
        ) : (
          <Text color="tertiary">Nothing scheduled or due.</Text>
        )}
      </div>
    </ScrollArea>
  );
}
