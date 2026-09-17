import { Badge, Button, Text } from "@glaze/core/components";
import { ExternalLink, Sparkles } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { eventTimeRange, isEventNow, isEventPast } from "../lib/dates";
import { openExternal } from "../lib/ipc";
import { featureOn, useSettings } from "../lib/settings";
import { useOpenMeetingPrep } from "./meeting-prep-dialog";
import { SourceDot } from "./source-dot";

export function EventRow({
  event,
  dot = "source",
  showCalendar,
}: {
  event: CalendarEventItem;
  /** "calendar" colors the dot by the event's Google calendar instead of the Calendar source. */
  dot?: "source" | "calendar";
  showCalendar?: boolean;
}) {
  const settings = useSettings().data;
  const openPrep = useOpenMeetingPrep();
  const past = isEventPast(event);
  const now = isEventNow(event);
  const detail = [event.location, showCalendar ? event.calendarName : null].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-3 px-3 py-2 min-h-12 min-w-0">
      {dot === "calendar" && event.calendarColor ? (
        <span
          aria-hidden="true"
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: event.calendarColor }}
        />
      ) : (
        <SourceDot source="calendar" />
      )}
      <Text variant="small" color={past ? "quaternary" : "secondary"} className="w-32 shrink-0 tabular-nums">
        {eventTimeRange(event)}
      </Text>
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <Text truncate color={past ? "tertiary" : "primary"}>
          {event.title}
        </Text>
        {detail ? (
          <Text variant="small" color="tertiary" truncate>
            {detail}
          </Text>
        ) : null}
      </div>
      {now ? (
        <Badge color="green" className="shrink-0">
          Now
        </Badge>
      ) : null}
      {featureOn(settings, "meetingPrep") && !past ? (
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label={`Prepare for ${event.title}`}
          title="Meeting prep"
          onClick={() => openPrep(event)}
        >
          <Sparkles />
        </Button>
      ) : null}
      {event.meetLink && !past ? (
        <Button size="small" onClick={() => void openExternal(event.meetLink!)}>
          Join
        </Button>
      ) : null}
      {event.htmlLink ? (
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label="Open in Google Calendar"
          title="Open in Google Calendar"
          onClick={() => void openExternal(event.htmlLink!)}
        >
          <ExternalLink />
        </Button>
      ) : null}
    </div>
  );
}
