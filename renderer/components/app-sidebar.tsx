import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  Button,
  Sidebar,
  SidebarFooter,
  SidebarList,
  SidebarListGroup,
  SidebarListItem,
  Text,
} from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import { CalendarCheck2, CalendarDays, Plus, Settings } from "lucide-react";
import type { SourceId } from "@main/shared-types";

import { eventDayKey, isEventPast, todayISO } from "../lib/dates";
import { openSettings } from "../lib/ipc";
import { useAccounts, useCalendar, useMail, useReminders, useTasks } from "../lib/queries";
import { PROVIDER_LABEL, featureOn, sourceOn, useSettings } from "../lib/settings";
import { COLOR_CLASS, SOURCE_IDS, SOURCE_META, sourceColor } from "../lib/sources";
import { useOpenCapture } from "./capture-dialog";
import { ProviderMark } from "./provider-logo";
import { GmailLogo } from "./source-logos";

function accountInitials(email?: string | null) {
  const localPart = email?.split("@", 1)[0] ?? "";
  const words = localPart.split(/[._-]+/).filter(Boolean);
  const initials = words
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
  return initials.toUpperCase() || "G";
}

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
    tasks:
      tasks.data?.state === "ok" ? tasks.data.items.filter((item) => !item.completed).length : 0,
    reminders:
      reminders.data?.state === "ok"
        ? reminders.data.items.filter((item) => !item.completed).length
        : 0,
    mail: mail.data?.state === "ok" ? mail.data.items.filter((item) => item.unread).length : 0,
    calendar:
      calendar.data?.state === "ok"
        ? calendar.data.items.filter((event) => eventDayKey(event) === today && !isEventPast(event))
            .length
        : 0,
  };

  const google = accounts.data?.google;
  const showAssistant = featureOn(settings, "assistant");
  const showReview = featureOn(settings, "weeklyReview");

  return (
    <Sidebar
      actions={
        <Button
          iconOnly
          aria-label="New task, reminder, or event"
          title="New item"
          onClick={openCapture}
        >
          <Plus />
        </Button>
      }
      footer={
        <SidebarFooter>
          <div className="flex flex-col gap-1 px-2 py-1.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar size="small" className="shrink-0">
                <AvatarFallback>{accountInitials(google?.email)}</AvatarFallback>
                <AvatarBadge color={google?.connected ? "green" : "gray"} />
              </Avatar>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <Text variant="small-strong" truncate>
                  {google?.email ?? (google?.connected ? "Google account" : "No Google account")}
                </Text>
                <Text variant="small" color="secondary" truncate>
                  {google?.connected ? "Gmail connected" : "Gmail not connected"}
                </Text>
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
            {settings?.ai.enabled ? (
              <Button
                variant="transparent"
                size="small"
                className="w-full justify-start"
                aria-label={
                  showAssistant
                    ? `Open ${PROVIDER_LABEL[settings.ai.provider]} Assistant`
                    : "Open AI settings"
                }
                onClick={() =>
                  showAssistant ? void navigate({ to: "/assistant" }) : void openSettings()
                }
              >
                <ProviderMark provider={settings.ai.provider} className="size-4" />
                {PROVIDER_LABEL[settings.ai.provider]}
              </Button>
            ) : null}
          </div>
        </SidebarFooter>
      }
    >
      <SidebarList>
        <SidebarListItem
          icon={<CalendarDays className="size-4" />}
          title="Agenda"
          selected={pathname === "/" || pathname === "/calendar"}
          onClick={() => void navigate({ to: "/" })}
        />
        {sourceOn(settings, "mail") ? (
          <SidebarListItem
            icon={
              <GmailLogo
                className={cn("size-4", COLOR_CLASS[sourceColor(settings, "mail")].text)}
              />
            }
            title="Inbox"
            accessory={counts.mail || undefined}
            selected={pathname === "/mail"}
            onClick={() => void navigate({ to: "/mail" })}
          />
        ) : null}
        <SidebarListGroup title="Sources" collapsible defaultOpen>
          {SOURCE_IDS.filter((id) => id !== "mail" && sourceOn(settings, id)).map((id) => {
            const meta = SOURCE_META[id];
            const Icon = meta.icon;
            return (
              <SidebarListItem
                key={id}
                icon={
                  <Icon className={cn("size-4", COLOR_CLASS[sourceColor(settings, id)].text)} />
                }
                title={meta.label}
                accessory={counts[id] || undefined}
                selected={pathname === meta.route}
                onClick={() =>
                  id === "calendar"
                    ? void navigate({ to: "/calendar" })
                    : void navigate({ to: meta.route })
                }
              />
            );
          })}
        </SidebarListGroup>
        {showAssistant || showReview ? (
          <SidebarListGroup title="AI">
            {showAssistant ? (
              <SidebarListItem
                icon={
                  <ProviderMark provider={settings?.ai.provider ?? "glaze"} className="size-4" />
                }
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
