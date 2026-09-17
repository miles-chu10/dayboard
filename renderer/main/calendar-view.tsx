import { EmptyState, ScrollArea, Text } from "@glaze/core/components";
import type { CalendarEventItem } from "@main/shared-types";

import { EventRow } from "../components/event-row";
import { ListCard, SectionCard } from "../components/section-card";
import { SourceDot, SourceHeading } from "../components/source-dot";
import { SourceGate } from "../components/source-gate";
import { ViewActions } from "../components/view-actions";
import { dayHeading, eventDayKey } from "../lib/dates";
import { useCalendar } from "../lib/queries";
import { useSettings } from "../lib/settings";

function groupByDay(events: CalendarEventItem[]): [string, CalendarEventItem[]][] {
  const groups = new Map<string, CalendarEventItem[]>();
  for (const event of events) {
    const key = eventDayKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

function CalendarLegend({ events }: { events: CalendarEventItem[] }) {
  const calendars = [...new Map(events.map((event) => [event.calendarId, event])).values()];
  if (calendars.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
      {calendars.map((event) => (
        <span key={event.calendarId} className="flex items-center gap-1.5 min-w-0">
          {event.calendarColor ? (
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: event.calendarColor }}
            />
          ) : (
            <SourceDot source="calendar" />
          )}
          <Text variant="small" color="secondary" truncate>
            {event.calendarName}
          </Text>
        </span>
      ))}
    </div>
  );
}

export function CalendarView() {
  const calendar = useCalendar();
  const daysAhead = useSettings().data?.calendar.daysAhead ?? 7;

  return (
    <ScrollArea
      className="h-full"
      title={<SourceHeading source="calendar" />}
      subtitle={`Next ${daysAhead} days`}
      actions={
        <ViewActions onRefresh={() => void calendar.refetch()} refreshing={calendar.isFetching} />
      }
    >
      <div className="flex flex-col gap-6 px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
        <SourceGate query={calendar} label="Google Calendar">
          {(events) => {
            const multiple = new Set(events.map((event) => event.calendarId)).size > 1;
            return events.length ? (
              <>
                <CalendarLegend events={events} />
                {groupByDay(events).map(([day, dayEvents]) => (
                  <SectionCard key={day} title={dayHeading(day)}>
                    <ListCard>
                      {dayEvents.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          dot="calendar"
                          showCalendar={multiple}
                        />
                      ))}
                    </ListCard>
                  </SectionCard>
                ))}
              </>
            ) : (
              <EmptyState
                placement="viewport"
                title="A Clear Stretch"
                description={`Nothing on your calendars for the next ${daysAhead} days.`}
              />
            );
          }}
        </SourceGate>
      </div>
    </ScrollArea>
  );
}
