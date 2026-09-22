import { Badge, Button, Checkbox, List, Text } from "@glaze/core/components";
import { CalendarDays, ExternalLink, Pin, Sparkles } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import type { AgendaEntry } from "../lib/agenda";
import { eventTimeRange, formatClock, shortDate, toISODate } from "../lib/dates";
import { openExternal } from "../lib/ipc";
import { useToggleTodo } from "../lib/queries";
import { featureOn, useSettings } from "../lib/settings";
import { SOURCE_META } from "../lib/sources";
import type { Todo } from "../lib/todos";
import { useOpenMeetingPrep } from "./meeting-prep-dialog";
import { SourceDot } from "./source-dot";

export const todoEntry = (todo: Todo): AgendaEntry => ({ kind: "todo", key: todo.key, todo });
export const eventEntry = (event: CalendarEventItem): AgendaEntry => ({
  kind: "event",
  key: `event:${event.calendarId}:${event.id}`,
  event,
});

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
  const openPrep = useOpenMeetingPrep();
  const settings = useSettings().data;
  function activate(entry: AgendaEntry) {
    if (entry.kind === "todo") onOpen(entry.todo);
    else if (featureOn(settings, "meetingPrep")) openPrep(entry.event);
    else if (entry.event.htmlLink) void openExternal(entry.event.htmlLink);
  }
  return (
    <List.Root
      items={entries}
      getItemKey={(item) => item.key}
      className="rounded-lg bg-well divide-y divide-separator"
      aria-label="Agenda items"
      onKeyDown={(event) => {
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
      }}
    >
      {entries.map((entry) => (
        <AgendaRow
          key={entry.key}
          entry={entry}
          now={now}
          focused={entry.kind === "todo" && focusKeys.includes(entry.todo.key)}
          onOpen={() => activate(entry)}
          onPin={() => {
            if (entry.kind === "todo") onPin(entry.todo);
          }}
        />
      ))}
    </List.Root>
  );
}

function AgendaRow({
  entry,
  now,
  focused,
  onOpen,
  onPin,
}: {
  entry: AgendaEntry;
  now: Date;
  focused: boolean;
  onOpen: () => void;
  onPin: () => void;
}) {
  const toggle = useToggleTodo();
  const settings = useSettings().data;
  const openPrep = useOpenMeetingPrep();
  const todo = entry.kind === "todo" ? entry.todo : null;
  const event = entry.kind === "event" ? entry.event : null;
  const today = toISODate(now);
  const missed = Boolean(
    todo?.dueDate &&
    (todo.dueDate < today ||
      (todo.dueDate === today &&
        todo.dueTime &&
        todo.dueTime <
          `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)),
  );
  const past = event && !event.allDay && new Date(event.end) <= now;
  const current =
    event && !event.allDay && new Date(event.start) <= now && new Date(event.end) > now;
  const title = todo?.title ?? event?.title ?? "";
  const when = todo
    ? todo.dueDate && todo.dueDate < today
      ? `Due ${shortDate(todo.dueDate)}`
      : todo.dueTime
        ? `Due ${formatClock(todo.dueTime)}`
        : "Anytime"
    : event
      ? eventTimeRange(event)
      : "";
  return (
    <List.Item
      item={entry}
      onClick={onOpen}
      className="min-h-14 gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={title}
      role="group"
      tabIndex={0}
      data-agenda-row
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
    >
      {todo ? (
        <Checkbox
          checked={todo.completed}
          disabled={toggle.isPending}
          onCheckedChange={() => toggle.mutate(todo)}
          aria-label={`Complete “${todo.title}”`}
        />
      ) : (
        <CalendarDays className="size-4 shrink-0 text-secondary" />
      )}
      <List.ItemContent>
        <List.ItemTitle className={past ? "text-tertiary" : ""}>{title}</List.ItemTitle>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Text variant="small" color={missed ? "red" : "secondary"} className="tabular-nums">
            {when}
          </Text>
          <SourceDot source={todo?.source ?? "calendar"} />
          <Text variant="small" color="tertiary" truncate>
            {todo
              ? `${SOURCE_META[todo.source].label} · ${todo.listTitle}`
              : (event?.calendarName ?? "Google Calendar")}
          </Text>
          {missed && todo?.dueDate === today ? (
            <Text variant="small" color="red">
              Due earlier today
            </Text>
          ) : null}
        </div>
      </List.ItemContent>
      <List.ItemAccessory>
        {current ? <Badge color="green">Now</Badge> : null}
        {todo ? (
          <Button
            size="small"
            variant="transparent"
            iconOnly
            aria-label={focused ? `Unpin ${title}` : `Focus on ${title}`}
            title={focused ? "Remove from focus" : "Add to focus"}
            aria-pressed={focused}
            onClick={onPin}
          >
            <Pin className={focused ? "text-accent" : ""} />
          </Button>
        ) : null}
        {event && featureOn(settings, "meetingPrep") && !past ? (
          <Button
            size="small"
            variant="transparent"
            iconOnly
            title="Meeting prep"
            aria-label={`Prepare for ${title}`}
            onClick={() => openPrep(event)}
          >
            <Sparkles />
          </Button>
        ) : null}
        {event?.meetLink && !past ? (
          <Button size="small" onClick={() => void openExternal(event.meetLink!)}>
            Join
          </Button>
        ) : null}
        <Button
          size="small"
          variant="transparent"
          iconOnly
          title={todo ? "Details" : "Open in Google Calendar"}
          aria-label={`Open ${title}`}
          onClick={() => (event?.htmlLink ? void openExternal(event.htmlLink) : onOpen())}
        >
          <ExternalLink />
        </Button>
      </List.ItemAccessory>
    </List.Item>
  );
}
