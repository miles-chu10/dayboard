import type { KeyboardEvent } from "react";
import { Button, Checkbox, Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import { AlignLeft, ChevronRight, Pin } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import type { AgendaEntry } from "../lib/agenda";
import { useToggleTodo } from "../lib/queries";
import type { Todo } from "../lib/todos";
import { DueChip, ListChip } from "./agenda-chips";
import { EventBar } from "./event-row";

export const todoEntry = (todo: Todo): AgendaEntry => ({
  kind: "todo",
  key: todo.key,
  todo,
});
export const eventEntry = (event: CalendarEventItem): AgendaEntry => ({
  kind: "event",
  key: `event:${event.calendarId}:${event.id}`,
  event,
});

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target;
  if (
    !(target instanceof HTMLElement) ||
    !target.hasAttribute("data-agenda-row") ||
    event.nativeEvent.isComposing
  )
    return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-agenda-row]")];
  const index = rows.indexOf(target);
  const next =
    event.key === "ArrowDown"
      ? Math.min(index + 1, rows.length - 1)
      : event.key === "ArrowUp"
        ? Math.max(index - 1, 0)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : null;
  if (next !== null) {
    event.preventDefault();
    rows[next]?.focus();
  }
}

/** Events as tinted bars first, then tasks and reminders as checklist rows (KiteTasks layout). */
export function AgendaList({
  entries,
  now,
  focusKeys,
  onOpen,
  onPin,
}: {
  entries: AgendaEntry[];
  now: Date;
  focusKeys: string[];
  onOpen: (todo: Todo) => void;
  onPin: (todo: Todo) => void;
}) {
  const events = entries.flatMap((entry) => (entry.kind === "event" ? [entry.event] : []));
  const todos = entries.flatMap((entry) => (entry.kind === "todo" ? [entry.todo] : []));
  return (
    <div
      className="flex flex-col gap-[var(--density-stack-gap)]"
      aria-label="Agenda items"
      onKeyDown={moveFocus}
    >
      {events.length ? (
        <div className="flex flex-col gap-[var(--density-bar-gap)]">
          {events.map((event) => (
            <EventBar key={`${event.calendarId}:${event.id}`} event={event} now={now} />
          ))}
        </div>
      ) : null}
      {todos.length ? (
        <div className="flex flex-col">
          {todos.map((todo) => (
            <TodoLine
              key={todo.key}
              todo={todo}
              now={now}
              focused={focusKeys.includes(todo.key)}
              onOpen={() => onOpen(todo)}
              onPin={() => onPin(todo)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TodoLine({
  todo,
  now,
  focused,
  onOpen,
  onPin,
}: {
  todo: Todo;
  now: Date;
  focused: boolean;
  onOpen: () => void;
  onPin: () => void;
}) {
  const toggle = useToggleTodo();
  return (
    <div
      role="group"
      tabIndex={0}
      data-agenda-row
      aria-label={todo.title}
      onClick={onOpen}
      onKeyDown={(keyEvent) => {
        if (
          keyEvent.target === keyEvent.currentTarget &&
          (keyEvent.key === "Enter" || keyEvent.key === " ") &&
          !keyEvent.nativeEvent.isComposing
        ) {
          keyEvent.preventDefault();
          onOpen();
        }
      }}
      className="group flex min-h-[var(--density-row)] min-w-0 items-center gap-3 rounded-md border-b border-separator px-2 last:border-b-0 hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <Checkbox
          className="rounded-full"
          checked={todo.completed}
          disabled={toggle.isPending}
          onCheckedChange={() => toggle.mutate(todo)}
          aria-label={`Complete “${todo.title}”`}
        />
      </span>
      <Text truncate className="min-w-0 flex-1">
        {todo.title}
      </Text>
      {todo.notes ? (
        <AlignLeft aria-label="Has notes" className="size-3.5 shrink-0 text-tertiary" />
      ) : null}
      <ListChip source={todo.source} listTitle={todo.listTitle} />
      {todo.dueDate ? <DueChip date={todo.dueDate} time={todo.dueTime} now={now} /> : null}
      <span
        className={cn(
          "flex",
          !focused &&
            "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label={focused ? `Unpin ${todo.title}` : `Focus on ${todo.title}`}
          title={focused ? "Remove from focus" : "Add to focus"}
          aria-pressed={focused}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            onPin();
          }}
        >
          <Pin className={focused ? "text-accent" : ""} />
        </Button>
      </span>
      <ChevronRight aria-hidden="true" className="-ml-2 size-3.5 shrink-0 text-quaternary" />
    </div>
  );
}
