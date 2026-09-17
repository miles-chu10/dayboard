import { Badge, Button, Text } from "@glaze/core/components";
import { ExternalLink } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { eventTimeRange, isEventNow, isEventPast } from "../lib/dates";
import { openExternal } from "../lib/ipc";

export function EventRow({ event }: { event: CalendarEventItem }) {
  const past = isEventPast(event);
  const now = isEventNow(event);

  return (
    <div className="flex items-center gap-3 px-3 py-2 min-h-12 min-w-0">
      <Text variant="small" color={past ? "quaternary" : "secondary"} className="w-36 shrink-0 tabular-nums">
        {eventTimeRange(event)}
      </Text>
      <div className="flex flex-col min-w-0 flex-1">
        <Text truncate color={past ? "tertiary" : "primary"}>
          {event.title}
        </Text>
        {event.location ? (
          <Text variant="small" color="tertiary" truncate>
            {event.location}
          </Text>
        ) : null}
      </div>
      {now ? (
        <Badge color="green" className="shrink-0">
          Now
        </Badge>
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
