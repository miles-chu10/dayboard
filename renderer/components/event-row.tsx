import type { KeyboardEvent } from "react";
import { Badge, Button, Text } from "@renderer/ui";
import { ExternalLink, Sparkles } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { formatTimeOfDay } from "../lib/dates";
import { openExternal } from "../lib/ipc";
import { featureOn, useSettings } from "../lib/settings";
import { sourceColor, sourceColorVar } from "../lib/sources";
import { useOpenMeetingPrep } from "./meeting-prep-dialog";

const REVEAL =
  "flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

function compactRange(event: CalendarEventItem): string {
  return event.allDay ? "All day" : `${formatTimeOfDay(event.start)}–${formatTimeOfDay(event.end)}`;
}

/** KiteTasks-style event: a tinted bar with a calendar-colored edge, time, then title. */
export function EventBar({
  event,
  now = new Date(),
  calendarColor = true,
  showCalendar,
  onOpen,
  expanded,
}: {
  event: CalendarEventItem;
  now?: Date;
  /** Opens event details; without it, a click opens meeting prep or Google Calendar. */
  onOpen?: () => void;
  /** Set when details are expanded inline under this bar. */
  expanded?: boolean;
  /** Tint by the event's Google calendar; otherwise by the Calendar source color. */
  calendarColor?: boolean;
  showCalendar?: boolean;
}) {
  const settings = useSettings().data;
  const openPrep = useOpenMeetingPrep();
  const prepOn = featureOn(settings, "meetingPrep");
  const past = !event.allDay && new Date(event.end) <= now;
  const current = !event.allDay && new Date(event.start) <= now && !past;
  const color =
    (calendarColor && event.calendarColor) || sourceColorVar(sourceColor(settings, "calendar"));
  const detail = [event.location, showCalendar ? event.calendarName : null]
    .filter(Boolean)
    .join(" · ");

  function activate() {
    if (onOpen) onOpen();
    else if (prepOn && !past) openPrep(event);
    else if (event.htmlLink) void openExternal(event.htmlLink);
  }
  function keydown(keyEvent: KeyboardEvent<HTMLDivElement>) {
    if (
      keyEvent.target === keyEvent.currentTarget &&
      (keyEvent.key === "Enter" || keyEvent.key === " ") &&
      !keyEvent.nativeEvent.isComposing
    ) {
      keyEvent.preventDefault();
      activate();
    }
  }

  return (
    <div
      role="group"
      tabIndex={0}
      data-agenda-row
      aria-label={`${event.title}, ${compactRange(event)}`}
      aria-expanded={expanded}
      onClick={activate}
      onKeyDown={keydown}
      className="group relative flex min-h-[var(--density-bar)] min-w-0 items-center gap-2.5 rounded-md py-[var(--density-bar-py)] pl-4 pr-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} ${past ? 7 : 15}%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute bottom-1.5 left-1.5 top-1.5 w-[3px] rounded-full"
        style={{ backgroundColor: color, opacity: past ? 0.5 : 1 }}
      />
      <Text
        variant="small"
        color={past ? "tertiary" : "secondary"}
        className="shrink-0 tabular-nums"
      >
        {compactRange(event)}
      </Text>
      <Text
        variant="small"
        truncate
        color={past ? "tertiary" : "primary"}
        className="min-w-0 font-medium"
      >
        {event.title}
      </Text>
      {detail ? (
        <Text variant="small" color="tertiary" truncate className="min-w-0">
          {detail}
        </Text>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {current ? <Badge color="green">Now</Badge> : null}
        {prepOn && !past ? (
          <span className={REVEAL}>
            <Button
              size="small"
              variant="transparent"
              iconOnly
              title="Meeting prep"
              aria-label={`Prepare for ${event.title}`}
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                openPrep(event);
              }}
            >
              <Sparkles />
            </Button>
          </span>
        ) : null}
        {event.meetLink && !past ? (
          <Button
            size="small"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              void openExternal(event.meetLink!);
            }}
          >
            Join
          </Button>
        ) : null}
        {event.htmlLink ? (
          <span className={REVEAL}>
            <Button
              size="small"
              variant="transparent"
              iconOnly
              title="Open in Google Calendar"
              aria-label={`Open ${event.title} in Google Calendar`}
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                void openExternal(event.htmlLink!);
              }}
            >
              <ExternalLink />
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EventRow({
  event,
  dot = "source",
  showCalendar,
}: {
  event: CalendarEventItem;
  /** "calendar" colors the bar by the event's Google calendar instead of the Calendar source. */
  dot?: "source" | "calendar";
  showCalendar?: boolean;
}) {
  return (
    <div className="px-2 py-[var(--density-bar-py)]">
      <EventBar event={event} calendarColor={dot === "calendar"} showCalendar={showCalendar} />
    </div>
  );
}
