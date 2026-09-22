import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarFooter,
  SidebarList,
  SidebarListGroup,
  SidebarListItem,
  Text,
} from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import { useState } from "react";
import { CalendarCheck2, CalendarDays, Plus, Server, Settings, Video } from "lucide-react";
import type { AppSettings, SourceId } from "@main/shared-types";

import { assistantProvider, selectedModel, useCodexModels } from "../lib/ai-models";
import { eventDayKey, formatTimeOfDay, isEventPast, todayISO } from "../lib/dates";
import { openExternal, openSettings } from "../lib/ipc";
import { useProfileAvatar } from "../lib/profile-avatar";
import { useAccounts, useCalendar, useMail, useReminders, useTasks } from "../lib/queries";
import { PROVIDER_LABEL, featureOn, providerUsesMcp, sourceOn, useSettings } from "../lib/settings";
import { COLOR_CLASS, SOURCE_META, sourceColor } from "../lib/sources";
import { buildTodos } from "../lib/todos";
import { useOpenCapture } from "./capture-dialog";
import { EventDetail } from "./event-detail";
import {
  McpServersDialog,
  useAssistantMcpCheck,
  useAssistantMcpServers,
} from "./mcp-servers-dialog";
import { ProviderMark } from "./provider-logo";
import { GmailLogo } from "./source-logos";

/** The name from Settings, or one derived from the Google address ("first.last" → "First Last"). */
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

type MainNavId = "agenda" | SourceId;

const MAIN_NAV: { id: MainNavId; title: string; route: string }[] = [
  { id: "agenda", title: "Agenda", route: "/" },
  { id: "calendar", title: "Calendar", route: "/calendar" },
  { id: "mail", title: "Inbox", route: "/mail" },
  { id: "tasks", title: "Tasks", route: "/tasks" },
  { id: "reminders", title: "Reminders", route: "/reminders" },
];

export function AppSidebar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const openCapture = useOpenCapture();
  const settings = useSettings().data;
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();
  const avatar = useProfileAvatar();
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
    "Change your name or picture in Settings → General.",
  ].join("\n");
  const status = !connected
    ? "Not connected"
    : remindersOk || !sourceOn(settings, "reminders")
      ? "Connected"
      : "Connected · Reminders off";
  const showAssistant = featureOn(settings, "assistant");
  const showReview = featureOn(settings, "weeklyReview");
  const [mcpOpen, setMcpOpen] = useState(false);
  const [upNextOpen, setUpNextOpen] = useState(false);
  const mcpServers = useAssistantMcpServers();
  const mcpCheck = useAssistantMcpCheck(showAssistant && Boolean(mcpServers.data?.length));
  const mcpResults = mcpCheck.data ?? [];
  const mcpOk = mcpResults.filter((result) => result.ok).length;
  const mcpError = mcpResults.some((result) => !result.ok);
  const mcpInUse = providerUsesMcp(provider);
  const agendaDue = open.filter((todo) => todo.dueDate === today).length;
  const agendaLate = overdue();
  const mcpCount = mcpServers.data?.length ?? 0;

  function navVisible(id: MainNavId): boolean {
    if (id === "agenda") return true;
    return sourceOn(settings, id);
  }

  function navIcon(id: MainNavId) {
    if (id === "agenda") return <CalendarDays className="size-4" />;
    if (id === "mail") {
      return (
        <GmailLogo className={cn("size-4", COLOR_CLASS[sourceColor(settings, "mail")].text)} />
      );
    }
    const Icon = SOURCE_META[id].icon;
    return <Icon className={cn("size-4", COLOR_CLASS[sourceColor(settings, id)].text)} />;
  }

  function navSelected(id: MainNavId, route: string): boolean {
    if (id === "agenda") return pathname === "/";
    return pathname === route;
  }

  function navSubtitle(id: MainNavId): string | undefined {
    if (id === "agenda") return summary(agendaDue, agendaLate);
    return subtitles[id];
  }

  function navAccessory(id: MainNavId) {
    if (id === "agenda") {
      return agendaLate ? (
        <span className="text-support-red tabular-nums" title={plural(agendaLate, "overdue item")}>
          {agendaLate}
        </span>
      ) : agendaDue ? (
        String(agendaDue)
      ) : undefined;
    }
    const count = counts[id];
    return count ? String(count) : undefined;
  }

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
                aria-label={`Open next event: ${nextEvent.title}`}
                onClick={() => setUpNextOpen(true)}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    setUpNextOpen(true);
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
            <div className="flex items-center gap-1.5 min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-control-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    title={connectionDetail}
                    aria-label={`Profile menu for ${name}`}
                  >
                    <Avatar size="small" className="shrink-0">
                      {avatar.dataUrl ? (
                        <AvatarImage src={avatar.dataUrl} alt={name} />
                      ) : null}
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
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start">
                  <DropdownMenuItem
                    icon="photo"
                    disabled={avatar.busy}
                    onSelect={() => avatar.pick()}
                  >
                    Change picture…
                  </DropdownMenuItem>
                  {avatar.hasAvatar ? (
                    <DropdownMenuItem
                      icon="trash"
                      color="red"
                      disabled={avatar.busy}
                      onSelect={() => avatar.clear()}
                    >
                      Remove picture
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon="gear" onSelect={() => void openSettings()}>
                    Settings…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        {MAIN_NAV.filter((item) => navVisible(item.id)).map((item) => (
          <SidebarListItem
            key={item.id}
            icon={navIcon(item.id)}
            title={item.title}
            subtitle={navSubtitle(item.id)}
            accessory={navAccessory(item.id)}
            selected={navSelected(item.id, item.route)}
            onClick={() => void navigate({ to: item.route })}
          />
        ))}
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
            {showAssistant ? (
              <SidebarListItem
                icon={<Server className="size-4" />}
                title="MCP Servers"
                subtitle={
                  !mcpCount
                    ? settings?.ai.useMcpInAssistant === false
                      ? "Turned off for the Assistant"
                      : "Add tools for the Assistant"
                    : !mcpInUse
                      ? `Not used by ${PROVIDER_LABEL[provider]}`
                      : mcpCheck.isFetching
                        ? "Checking…"
                        : mcpError
                          ? `${mcpOk}/${mcpCount} available`
                          : plural(mcpCount, "server")
                }
                accessory={
                  mcpCount ? (
                    <span
                      role="img"
                      aria-label={
                        mcpError ? "Some servers unavailable" : mcpOk ? "Connected" : "Not checked"
                      }
                      className={cn(
                        "inline-block size-2 rounded-full",
                        mcpError
                          ? "bg-support-red"
                          : mcpOk
                            ? "bg-support-green"
                            : "bg-current text-tertiary",
                      )}
                    />
                  ) : undefined
                }
                onClick={() => setMcpOpen(true)}
              />
            ) : null}
          </SidebarListGroup>
        ) : null}
      </SidebarList>
      <McpServersDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
        providerNote={
          mcpInUse
            ? null
            : `${PROVIDER_LABEL[provider]} can't use MCP servers from DayBoard yet; switch the Assistant to Claude, ChatGPT, or an API model to use them.`
        }
      />
      {upNextOpen && nextEvent ? (
        <EventDetail
          key={nextEvent.id}
          event={nextEvent}
          presentation="dialog"
          onClose={() => setUpNextOpen(false)}
        />
      ) : null}
    </Sidebar>
  );
}
