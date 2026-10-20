import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Callout, Dialog, Markdown, Status, Text } from "@glaze/core/components";
import { Sparkles } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { dayHeading, eventDayKey, eventTimeRange } from "../lib/dates";
import { useMeetingPrep } from "../lib/meeting-prep";

const PrepContext = createContext<(event: CalendarEventItem) => void>(() => {});

export function useOpenMeetingPrep() {
  return useContext(PrepContext);
}

export function MeetingPrepProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<CalendarEventItem | null>(null);
  return (
    <PrepContext.Provider value={setEvent}>
      {children}
      {event ? (
        <MeetingPrepDialog key={event.id} event={event} onClose={() => setEvent(null)} />
      ) : null}
    </PrepContext.Provider>
  );
}

function MeetingPrepDialog({ event, onClose }: { event: CalendarEventItem; onClose: () => void }) {
  const { ai, attendees, stored, text, relatedReady, contextSummary, generate } =
    useMeetingPrep(event);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          ai.stop();
          onClose();
        }
      }}
      size="large"
      title={event.title}
      description={`${dayHeading(eventDayKey(event))} · ${eventTimeRange(event)}${
        attendees.length
          ? ` · ${attendees.length} ${attendees.length === 1 ? "attendee" : "attendees"}`
          : ""
      }`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Text variant="small" color="tertiary" truncate className="flex-1 min-w-0">
            {contextSummary}
          </Text>
          {ai.isRunning ? (
            <Button size="small" onClick={ai.stop}>
              Stop
            </Button>
          ) : (
            <Button size="small" onClick={generate} disabled={!relatedReady}>
              <Sparkles />
              {stored ? "Regenerate" : "Prepare"}
            </Button>
          )}
        </div>
        {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
        <div className="rounded-lg bg-well px-4 py-3 min-h-24">
          {text ? (
            <Markdown isStreaming={ai.isRunning}>{text}</Markdown>
          ) : ai.isRunning ? (
            <Status variant="loading">Preparing your notes…</Status>
          ) : (
            <Text color="tertiary" as="p">
              Get the purpose, context from recent emails, open items, and talking points for this
              meeting.
            </Text>
          )}
        </div>
      </div>
    </Dialog>
  );
}
