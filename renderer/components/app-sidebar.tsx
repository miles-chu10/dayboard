import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Button,
  Sidebar,
  SidebarFooter,
  SidebarList,
  SidebarListGroup,
  SidebarListItem,
  Status,
} from "@glaze/core/components";
import { CalendarDays, ListChecks, ListTodo, Mail, Plus, Settings, Sun } from "lucide-react";

import { eventDayKey, isEventPast, todayISO } from "../lib/dates";
import { openSettings } from "../lib/ipc";
import { useAccounts, useCalendar, useMail, useReminders, useTasks } from "../lib/queries";
import { useOpenCapture } from "./capture-dialog";

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const openCapture = useOpenCapture();
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();

  const today = todayISO();
  const counts = {
    tasks: tasks.data?.state === "ok" ? tasks.data.items.filter((item) => !item.completed).length : 0,
    reminders: reminders.data?.state === "ok" ? reminders.data.items.filter((item) => !item.completed).length : 0,
    mail: mail.data?.state === "ok" ? mail.data.items.filter((item) => item.unread).length : 0,
    calendar:
      calendar.data?.state === "ok"
        ? calendar.data.items.filter((event) => eventDayKey(event) === today && !isEventPast(event)).length
        : 0,
  };

  const google = accounts.data?.google;

  return (
    <Sidebar
      actions={
        <Button iconOnly aria-label="New task, reminder, or event" title="New item" onClick={openCapture}>
          <Plus />
        </Button>
      }
      footer={
        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 py-1 min-w-0">
            <Status variant={google?.connected ? "success" : "neutral"} className="min-w-0 truncate">
              {google?.connected ? (google.email ?? "Google connected") : "Google not connected"}
            </Status>
            <Button
              iconOnly
              size="small"
              variant="transparent"
              className="ml-auto shrink-0"
              aria-label="Settings"
              title="Settings"
              onClick={() => void openSettings()}
            >
              <Settings />
            </Button>
          </div>
        </SidebarFooter>
      }
    >
      <SidebarList>
        <SidebarListItem
          icon={<Sun className="size-4" />}
          title="Today"
          selected={pathname === "/"}
          onClick={() => void navigate({ to: "/" })}
        />
        <SidebarListGroup title="Sources">
          <SidebarListItem
            icon={<ListChecks className="size-4" />}
            title="Google Tasks"
            accessory={counts.tasks || undefined}
            selected={pathname === "/tasks"}
            onClick={() => void navigate({ to: "/tasks" })}
          />
          <SidebarListItem
            icon={<ListTodo className="size-4" />}
            title="Reminders"
            accessory={counts.reminders || undefined}
            selected={pathname === "/reminders"}
            onClick={() => void navigate({ to: "/reminders" })}
          />
          <SidebarListItem
            icon={<Mail className="size-4" />}
            title="Mail"
            accessory={counts.mail || undefined}
            selected={pathname === "/mail"}
            onClick={() => void navigate({ to: "/mail" })}
          />
          <SidebarListItem
            icon={<CalendarDays className="size-4" />}
            title="Calendar"
            accessory={counts.calendar || undefined}
            selected={pathname === "/calendar"}
            onClick={() => void navigate({ to: "/calendar" })}
          />
        </SidebarListGroup>
      </SidebarList>
    </Sidebar>
  );
}
