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
import { cn } from "@glaze/core/utils";
import { CalendarCheck2, MessageSquareText, Plus, Settings, Sun } from "lucide-react";
import type { SourceId } from "@main/shared-types";

import { eventDayKey, isEventPast, todayISO } from "../lib/dates";
import { openSettings } from "../lib/ipc";
import { useAccounts, useCalendar, useMail, useReminders, useTasks } from "../lib/queries";
import { PROVIDER_LABEL, featureOn, sourceOn, useSettings } from "../lib/settings";
import { COLOR_CLASS, SOURCE_IDS, SOURCE_META, sourceColor } from "../lib/sources";
import { useOpenCapture } from "./capture-dialog";

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const openCapture = useOpenCapture();
  const settings = useSettings().data;
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();

  const today = todayISO();
  const counts: Record<SourceId, number> = {
    tasks: tasks.data?.state === "ok" ? tasks.data.items.filter((item) => !item.completed).length : 0,
    reminders: reminders.data?.state === "ok" ? reminders.data.items.filter((item) => !item.completed).length : 0,
    mail: mail.data?.state === "ok" ? mail.data.items.filter((item) => item.unread).length : 0,
    calendar:
      calendar.data?.state === "ok"
        ? calendar.data.items.filter((event) => eventDayKey(event) === today && !isEventPast(event)).length
        : 0,
  };

  const google = accounts.data?.google;
  const showAssistant = featureOn(settings, "assistant");
  const showReview = featureOn(settings, "weeklyReview");

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
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <Status variant={google?.connected ? "success" : "neutral"} className="min-w-0 truncate">
                {google?.connected ? (google.email ?? "Google connected") : "Google not connected"}
              </Status>
              {settings?.ai.enabled ? (
                <Status variant="neutral" className="min-w-0 truncate">
                  AI: {PROVIDER_LABEL[settings.ai.provider]}
                </Status>
              ) : null}
            </div>
            <Button
              iconOnly
              size="small"
              variant="transparent"
              className="shrink-0"
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
          {SOURCE_IDS.filter((id) => sourceOn(settings, id)).map((id) => {
            const meta = SOURCE_META[id];
            const Icon = meta.icon;
            return (
              <SidebarListItem
                key={id}
                icon={<Icon className={cn("size-4", COLOR_CLASS[sourceColor(settings, id)].text)} />}
                title={meta.label}
                accessory={counts[id] || undefined}
                selected={pathname === meta.route}
                onClick={() => void navigate({ to: meta.route })}
              />
            );
          })}
        </SidebarListGroup>
        {showAssistant || showReview ? (
          <SidebarListGroup title="AI">
            {showAssistant ? (
              <SidebarListItem
                icon={<MessageSquareText className="size-4" />}
                title="Assistant"
                selected={pathname === "/assistant"}
                onClick={() => void navigate({ to: "/assistant" })}
              />
            ) : null}
            {showReview ? (
              <SidebarListItem
                icon={<CalendarCheck2 className="size-4" />}
                title="Weekly Review"
                selected={pathname === "/review"}
                onClick={() => void navigate({ to: "/review" })}
              />
            ) : null}
          </SidebarListGroup>
        ) : null}
      </SidebarList>
    </Sidebar>
  );
}
