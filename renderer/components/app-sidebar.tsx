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
import { CalendarCheck2, CalendarDays, Plus, Settings, Video } from "lucide-react";
import type { AppSettings, SourceId } from "@main/shared-types";

import { assistantProvider, selectedModel, useCodexModels } from "../lib/ai-models";
import { eventDayKey, formatTimeOfDay, isEventPast, todayISO } from "../lib/dates";
import { openExternal, openSettings } from "../lib/ipc";
import { useAccounts, useCalendar, useMail, useReminders, useTasks } from "../lib/queries";
import { PROVIDER_LABEL, featureOn, sourceOn, useSettings } from "../lib/settings";
import { COLOR_CLASS, SOURCE_IDS, SOURCE_META, sourceColor } from "../lib/sources";
import { buildTodos } from "../lib/todos";
import { useOpenCapture } from "./capture-dialog";
import { ProviderMark } from "./provider-logo";
import { GmailLogo } from "./source-logos";

/** The name from Settings, or one derived from the Google address ("miles.chu" → "Miles Chu"). */
export function displayName(settings: AppSettings | undefined, email?: string | null): string {
  const configured = settings?.general.userName.trim();
  if (configured) return configured;
  const local = email?.split("@", 1)[0] ?? "";
  const words = local.split(/[._-]+/).filter((word) => /^[a-z]+$/i.test(word));
  return words.length
    ? words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" ")
    : (email ?? "You");
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
  return letters.toUpperCase() || "Y";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
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
  const provider = assistantProvider(settings);
  const codexModels = useCodexModels(provider === "codex");
  const model = selectedModel(settings, codexModels.data, provider);

  const today = todayISO();
  const now = new Date();
  const open = buildTodos(tasks.data, reminders.data).filter((todo) => !todo.completed);
  const dueToday = (source: SourceId) =>
    open.filter((todo) => todo.source === source && todo.dueDate === today).length;
  const overdue = (source?: SourceId) =>
    open.filter(
      (todo) => (!source || todo.source === source) && todo.dueDate && todo.dueDate < today,
    ).length;
  const todayEvents =
    calendar.data?.state === "ok"
      ? calendar.data.items.filter((event) => eventDayKey(event) === today && !isEventPast(event))
      : [];
  const nextEvent = todayEvents.find((event) => !event.allDay && new Date(event.end) > now);
  const unread = mail.data?.state === "ok" ? mail.data.items.filter((item) => item.unread) : [];

  const counts: Record<SourceId, number> = {
    tasks: open.filter((todo) => todo.source === "tasks").length,
    reminders: open.filter((todo) => todo.source === "reminders").length,
    mail: unread.length,
    calendar: todayEvents.length,
  };
  const subtitles: Record<SourceId, string | undefined> = {
    tasks: summary(dueToday("tasks"), overdue("tasks")),
    reminders: summary(dueToday("reminders"), overdue("reminders")),
    mail: unread[0] ? `Latest: ${unread[0].from}` : undefined,
    calendar: nextEvent
      ? `Next ${formatTimeOfDay(nextEvent.start)} · ${nextEvent.title}`
      : todayEvents.length
        ? undefined
        : "Nothing else today",
  };
  function summary(due: number, late: number): string | undefined {
    return (
      [due ? `${due} due today` : null, late ? `${late} overdue` : null]
        .filter(Boolean)
        .join(" · ") || undefined
    );
  }

  const google = accounts.data?.google;
  const name = displayName(settings, google?.email);
  const remindersOk = accounts.data?.reminders === "full-access";
  const connected = Boolean(google?.connected);
  const connectionDetail = [
    google?.connected ? `Google: ${google.email ?? "connected"}` : "Google: not connected",
    `Apple Reminders: ${remindersOk ? "allowed" : "not allowed"}`,
  ].join("\n");
  const status = !connected
    ? "Not connected"
    : remindersOk || !sourceOn(settings, "reminders")
      ? "Connected"
      : "Connected · Reminders off";
  const showAssistant = featureOn(settings, "assistant");
  const showReview = featureOn(settings, "weeklyReview");
  const agendaDue = open.filter((todo) => todo.dueDate === today).length;
  const agendaLate = overdue();

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
          <div className="flex flex-col gap-1.5 px-2 py-1.5 min-w-0">
            {nextEvent && sourceOn(settings, "calendar") ? (
              <div
                role="button"
                tabIndex={0}
                aria-label={`Open Calendar: ${nextEvent.title}`}
                onClick={() => void navigate({ to: "/calendar" })}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    void navigate({ to: "/calendar" });
                  }
                }}
                className="flex cursor-default items-center gap-2 rounded-lg bg-control-subtle px-2 py-1.5 text-left hover:bg-control"
              >
                <span
                  aria-hidden="true"
                  className="h-7 w-[3px] shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      nextEvent.calendarColor ?? `var(--${sourceColor(settings, "calendar")})`,
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Text variant="small" color="secondary">
                    {new Date(nextEvent.start) <= now
                      ? "Now"
                      : `Up next · ${formatTimeOfDay(nextEvent.start)}`}
                  </Text>
                  <Text variant="small-strong" truncate>
                    {nextEvent.title}
                  </Text>
                </span>
                {nextEvent.meetLink ? (
                  <Button
                    size="small"
                    iconOnly
                    aria-label={`Join ${nextEvent.title}`}
                    title="Join"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openExternal(nextEvent.meetLink!);
                    }}
                  >
                    <Video />
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-2 min-w-0" title={connectionDetail}>
              <Avatar size="small" className="shrink-0">
                <AvatarFallback>{initials(name)}</AvatarFallback>
                <AvatarBadge color={connected ? "green" : "gray"} />
              </Avatar>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <Text variant="small-strong" truncate>
                  {name}
                </Text>
                <Text variant="small" color={connected ? "green" : "secondary"} truncate>
                  {status}
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
          </div>
        </SidebarFooter>
      }
    >
      <SidebarList>
        <SidebarListItem
          icon={<CalendarDays className="size-4" />}
          title="Agenda"
          subtitle={summary(agendaDue, agendaLate)}
          accessory={
            agendaLate ? (
              <span
                className="text-support-red tabular-nums"
                title={plural(agendaLate, "overdue item")}
              >
                {agendaLate}
              </span>
            ) : agendaDue ? (
              String(agendaDue)
            ) : undefined
          }
          selected={pathname === "/"}
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
            subtitle={subtitles.mail}
            accessory={counts.mail ? String(counts.mail) : undefined}
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
                subtitle={subtitles[id]}
                accessory={counts[id] ? String(counts[id]) : undefined}
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
                icon={<ProviderMark provider={provider} className="size-4" />}
                title="Assistant"
                subtitle={
                  provider === "glaze"
                    ? PROVIDER_LABEL.glaze
                    : `${PROVIDER_LABEL[provider]} · ${model.label}${model.fast ? " · Fast" : ""}`
                }
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
