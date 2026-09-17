import { EmptyState, ScrollArea } from "@glaze/core/components";
import type { CalendarEventItem } from "@main/shared-types";

import { EventRow } from "../components/event-row";
import { ListCard, SectionCard } from "../components/section-card";
import { SourceGate } from "../components/source-gate";
import { ViewActions } from "../components/view-actions";
import { dayHeading, eventDayKey } from "../lib/dates";
import { useCalendar } from "../lib/queries";

function groupByDay(events: CalendarEventItem[]): [string, CalendarEventItem[]][] {
  const groups = new Map<string, CalendarEventItem[]>();
  for (const event of events) {
    const key = eventDayKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

export function CalendarView() {
  const calendar = useCalendar();

  return (
    <ScrollArea
      className="h-full"
      title="Calendar"
      subtitle="Next 7 days"
      actions={
        <ViewActions onRefresh={() => void calendar.refetch()} refreshing={calendar.isFetching} />
      }
    >
      <div className="flex flex-col gap-6 px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
        <SourceGate query={calendar} label="Google Calendar">
          {(events) =>
            events.length ? (
              groupByDay(events).map(([day, dayEvents]) => (
                <SectionCard key={day} title={dayHeading(day)}>
                  <ListCard>
                    {dayEvents.map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </ListCard>
                </SectionCard>
              ))
            ) : (
              <EmptyState
                placement="viewport"
                title="A Clear Week"
                description="Nothing on your primary calendar for the next 7 days."
              />
            )
          }
        </SourceGate>
      </div>
    </ScrollArea>
  );
}
