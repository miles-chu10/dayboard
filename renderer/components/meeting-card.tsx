import { Button, Callout, Markdown, Status, Text, cn } from "@renderer/ui";
import { Sparkles, Video } from "lucide-react";
import type { CalendarEventItem } from "@main/shared-types";

import { pickUpNext, startLabel, type UpNext } from "@shared/meetings";
import { eventTimeRange, todayISO } from "../lib/dates";
import { openExternal } from "../lib/ipc";
import { useMeetingPrep } from "../lib/meeting-prep";
import { useCalendarRange } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { useAgendaClock } from "../lib/use-agenda-clock";

function UpNextMeeting({
  upNext,
  compact,
}: {
  upNext: UpNext<CalendarEventItem>;
  compact: boolean;
}) {
  const settings = useSettings().data;
  const { event, joinUrl } = upNext;
  const prep = useMeetingPrep(event);
  const prepOn = featureOn(settings, "meetingPrep");
  const people = prep.attendees.length;

  return (
    <section
      aria-label="Up next meeting"
      className="flex flex-col gap-2 rounded-lg border border-separator bg-well px-3 py-2.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Text as="p" variant="small" color={upNext.phase === "later" ? "secondary" : "accent"}>
            {startLabel(upNext)} · {eventTimeRange(event)}
          </Text>
          <Text as="p" variant="regular" className="font-semibold" truncate>
            {event.title}
          </Text>
          {people ? (
            <Text as="p" variant="small" color="tertiary">
              {people} {people === 1 ? "other attendee" : "other attendees"}
            </Text>
          ) : null}
        </div>
        {joinUrl ? (
          <Button size="small" variant="accent" onClick={() => void openExternal(joinUrl)}>
            <Video />
            Join
          </Button>
        ) : null}
      </div>
      {prepOn ? (
        <div className="flex flex-col gap-1.5">
          {prep.ai.message ? <Callout color="orange">{prep.ai.message}</Callout> : null}
          {prep.text ? (
            <div className={cn("overflow-hidden text-small", compact ? "max-h-24" : "max-h-48")}>
              <Markdown isStreaming={prep.ai.isRunning}>{prep.text}</Markdown>
            </div>
          ) : prep.ai.isRunning ? (
            <Status variant="loading">Preparing your notes…</Status>
          ) : null}
          <div>
            {prep.ai.isRunning ? (
              <Button size="small" onClick={prep.ai.stop}>
                Stop
              </Button>
            ) : (
              <Button size="small" onClick={prep.generate} disabled={!prep.relatedReady}>
                <Sparkles />
                {prep.stored ? "Prepare Again" : "Prepare"}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The next meeting with its join link and prep; hidden when switched off or nothing is next. */
export function MeetingCard({ surface }: { surface: "agenda" | "menubar" }) {
  const settings = useSettings().data;
  const now = useAgendaClock();
  const calendar = useCalendarRange(todayISO(), 2);
  if (!settings?.system.meetings.upNext || !sourceOn(settings, "calendar")) return null;
  const events = calendar.data?.state === "ok" ? calendar.data.items : [];
  const upNext = pickUpNext(events, now);
  if (!upNext) return null;
  return (
    <UpNextMeeting
      key={`${upNext.event.calendarId}/${upNext.event.id}`}
      upNext={upNext}
      compact={surface === "menubar"}
    />
  );
}
