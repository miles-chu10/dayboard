import { Button, Dialog, Field, FieldGroup, Text } from "@renderer/ui";
import { ExternalLink, Sparkles, Video } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { eventTimeRange, parseISODate } from "../lib/dates";
import { openExternal } from "../lib/ipc";
import { featureOn, useSettings } from "../lib/settings";
import { sourceColor, sourceColorVar } from "../lib/sources";
import { DetailPanel } from "./detail-panel";
import { ItemEditButton } from "./item-editor";
import { useOpenMeetingPrep } from "./meeting-prep-dialog";

/** Google descriptions are HTML; show them as plain text. DOMParser never runs scripts. */
function plainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n");
  const text = new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function EventDetail({
  event,
  presentation,
  onClose,
}: {
  event: CalendarEventItem;
  presentation: "dialog" | "panel";
  onClose: () => void;
}) {
  const settings = useSettings().data;
  const openPrep = useOpenMeetingPrep();
  const prepOn = featureOn(settings, "meetingPrep");
  const color = event.calendarColor ?? sourceColorVar(sourceColor(settings, "calendar"));
  const day = (
    event.allDay ? parseISODate(event.start.slice(0, 10)) : new Date(event.start)
  ).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const description = event.description ? plainText(event.description) : "";

  const body = (
    <div className="flex flex-col gap-4">
      <FieldGroup>
        <Field label="When" orientation="vertical">
          <Text>
            {day} · {eventTimeRange(event)}
          </Text>
        </Field>
        <Field label="Calendar" orientation="vertical">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <Text>{event.calendarName}</Text>
          </span>
        </Field>
        {event.location ? (
          <Field label="Location" orientation="vertical">
            <Text className="break-words">{event.location}</Text>
          </Field>
        ) : null}
        {event.attendees.length ? (
          <Field label={`Guests · ${event.attendees.length}`} orientation="vertical">
            <Text className="break-words">{event.attendees.join(", ")}</Text>
          </Field>
        ) : null}
        {description ? (
          <Field label="Description" orientation="vertical">
            <Text className="whitespace-pre-wrap break-words">{description}</Text>
          </Field>
        ) : null}
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <ItemEditButton item={event} onSaved={onClose} />
        {event.meetLink ? (
          <Button size="small" onClick={() => void openExternal(event.meetLink!)}>
            <Video />
            Join
          </Button>
        ) : null}
        {prepOn ? (
          <Button
            size="small"
            variant="transparent"
            onClick={() => {
              if (presentation === "dialog") onClose();
              openPrep(event);
            }}
          >
            <Sparkles />
            Meeting prep
          </Button>
        ) : null}
        {event.htmlLink ? (
          <Button
            size="small"
            variant="transparent"
            onClick={() => void openExternal(event.htmlLink!)}
          >
            <ExternalLink />
            Open in Google Calendar
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (presentation === "dialog") {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={event.title}
        description={event.calendarName}
        confirmLabel="Done"
        onConfirm={onClose}
      >
        {body}
      </Dialog>
    );
  }
  return (
    <DetailPanel title={event.title} subtitle={event.calendarName} onClose={onClose}>
      {body}
    </DetailPanel>
  );
}
