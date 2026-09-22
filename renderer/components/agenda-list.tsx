import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import { Button, Checkbox, Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import { AlignLeft, ChevronRight, Link2, Pin } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import type { AgendaEntry } from "../lib/agenda";
import { useToggleTodo } from "../lib/queries";
import type { Todo } from "../lib/todos";
import { DueChip, ListChip } from "./agenda-chips";
import { calendarEventKey } from "../lib/calendar-identity";
import { EventBar } from "./event-row";

export const todoEntry = (todo: Todo): AgendaEntry => ({
  kind: "todo",
  key: todo.key,
  todo,
});
export const eventEntry = (event: CalendarEventItem): AgendaEntry => ({
  kind: "event",
  key: calendarEventKey(event),
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
  onOpenEvent,
  onPin,
  expandedKey,
  renderExpanded,
}: {
  entries: AgendaEntry[];
  now: Date;
  focusKeys: string[];
  onOpen: (todo: Todo) => void;
  onOpenEvent?: (event: CalendarEventItem, key: string) => void;
  onPin: (todo: Todo) => void;
  /** Item (todo key or event key) whose details render inline under its row. */
  expandedKey?: string;
  renderExpanded?: () => ReactNode;
}) {
  const inline = (key: string) =>
    expandedKey === key && renderExpanded ? (
      <div className="py-1 pl-6">{renderExpanded()}</div>
    ) : null;
  const events = entries.flatMap((entry) => (entry.kind === "event" ? [entry] : []));
  const todos = entries.flatMap((entry) => (entry.kind === "todo" ? [entry.todo] : []));
  return (
    <div
      className="@container flex flex-col gap-[var(--density-stack-gap)]"
      aria-label="Agenda items"
      onKeyDown={moveFocus}
    >
      {events.length ? (
        <div className="flex flex-col gap-[var(--density-bar-gap)]">
          {events.map(({ event, key }) => (
            <Fragment key={key}>
              <EventBar
                event={event}
                now={now}
                onOpen={onOpenEvent ? () => onOpenEvent(event, key) : undefined}
                expanded={renderExpanded ? expandedKey === key : undefined}
              />
              {inline(key)}
            </Fragment>
          ))}
        </div>
      ) : null}
      {todos.length ? (
        <div className="flex flex-col">
          {todos.map((todo) => (
            <Fragment key={todo.key}>
              <TodoLine
                todo={todo}
                now={now}
                focused={(todo.linkedKeys ?? [todo.key]).some((key) => focusKeys.includes(key))}
                expanded={renderExpanded ? expandedKey === todo.key : undefined}
                onOpen={() => onOpen(todo)}
                onPin={() => onPin(todo)}
              />
              {inline(todo.key)}
            </Fragment>
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
  expanded,
  onOpen,
  onPin,
}: {
  todo: Todo;
  now: Date;
  focused: boolean;
  expanded?: boolean;
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
      aria-expanded={expanded}
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
      <Text truncate className="min-w-24 flex-1">
        {todo.title}
      </Text>
      {todo.notes ? (
        <AlignLeft aria-label="Has notes" className="size-3.5 shrink-0 text-tertiary" />
      ) : null}
      {(todo.linkedKeys?.length ?? 0) > 1 ? (
        <span
          role="img"
          aria-label="Linked items"
          className="flex shrink-0"
          title="Completing this item also updates its available linked items."
        >
          <Link2 aria-hidden="true" className="size-3.5 text-tertiary" />
        </span>
      ) : null}
      {/* List chips give way to the title in narrow panels. */}
      <span className="hidden @[34rem]:contents">
        <ListChip source={todo.source} listTitle={todo.listTitle} />
        {todo.linked?.map((item) => (
          <ListChip key={item.key} source={item.source} listTitle={item.listTitle} />
        ))}
      </span>
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
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "-ml-2 size-3.5 shrink-0 text-quaternary transition-transform",
          expanded && "rotate-90",
        )}
      />
    </div>
  );
}
