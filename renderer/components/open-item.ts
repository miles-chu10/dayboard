import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { CalendarEventItem } from "@main/shared-types";

import { calendarEventKey } from "../lib/calendar-identity";
import { eventDayKey, todayISO } from "../lib/dates";
import type { Todo } from "../lib/todos";

/** Opens an email, event or todo in the view that shows its details. */
export function useOpenItem() {
  const navigate = useNavigate();
  const openMail = useCallback(
    (id: string) => void navigate({ to: "/mail", search: { item: id } }),
    [navigate],
  );
  const openEvent = useCallback(
    (event: CalendarEventItem) =>
      void navigate({
        to: "/calendar",
        search: {
          date: eventDayKey(event),
          view: "week",
          item: calendarEventKey(event),
        },
      }),
    [navigate],
  );
  const openTodo = useCallback(
    (todo: Todo) =>
      void navigate({
        to: "/",
        search: {
          item: todo.key,
          date: todo.dueDate && todo.dueDate >= todayISO() ? todo.dueDate : undefined,
        },
      }),
    [navigate],
  );
  return { openMail, openEvent, openTodo };
}
