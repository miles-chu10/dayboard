import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Callout, ScrollArea, Status } from "@glaze/core/components";
import type { MailItem, SourceId, SourceResult } from "@main/shared-types";

import { AskAssistantCard } from "../components/ask-assistant-card";
import { BriefingCard } from "../components/briefing-card";
import { EventRow } from "../components/event-row";
import { MailRow } from "../components/mail-row";
import { ReplyDialog } from "../components/reply-dialog";
import { InlineHint, ListCard, RowsSkeleton, SectionCard } from "../components/section-card";
import { SourceHeading } from "../components/source-dot";
import { sourceHint, sourceStatusShort } from "../components/source-gate";
import { SourceTile } from "../components/source-tile";
import { UpNextCard } from "../components/up-next-card";
import { ViewActions } from "../components/view-actions";
import { buildBriefingPrompt } from "../lib/ai-prompts";
import {
  eventDayKey,
  formatTimeOfDay,
  isEventNow,
  isEventPast,
  longToday,
  todayISO,
} from "../lib/dates";
import { openSettings } from "../lib/ipc";
import {
  useAccounts,
  useCalendar,
  useConnectGoogle,
  useMail,
  useReminders,
  useRequestRemindersAccess,
  useTasks,
} from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { buildTodos } from "../lib/todos";
import { useTriage } from "../lib/triage";

const TILE_GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

export function HomeView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settingsQuery = useSettings();
  const settings = settingsQuery.data;
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();
  const connectGoogle = useConnectGoogle();
  const requestReminders = useRequestRemindersAccess();
  const [replyTo, setReplyTo] = useState<MailItem | null>(null);

  const on: Record<SourceId, boolean> = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
    mail: sourceOn(settings, "mail"),
    calendar: sourceOn(settings, "calendar"),
  };
  const today = todayISO();
  const todos = buildTodos(tasks.data, reminders.data);
  const openTodos = todos.filter((todo) => !todo.completed);
  const todayEvents =
    calendar.data?.state === "ok"
      ? calendar.data.items.filter((event) => eventDayKey(event) === today)
      : [];
  const messages = mail.data?.state === "ok" ? mail.data.items : undefined;
  const triage = useTriage(messages);
  const triageOn = featureOn(settings, "triage");

  const google = accounts.data?.google;
  const googleSourcesOn = on.tasks || on.mail || on.calendar;
  const todosAvailable = tasks.data?.state === "ok" || reminders.data?.state === "ok";
  const loadingSources =
    !settingsQuery.isSuccess ||
    tasks.isPending ||
    reminders.isPending ||
    mail.isPending ||
    calendar.isPending;
  const refreshing =
    tasks.isFetching || reminders.isFetching || mail.isFetching || calendar.isFetching;

  const showNeedsReply = triageOn && triage.hasResults;
  const needsReply =
    messages?.filter((message) => triage.map[message.id]?.category === "needs-reply") ?? [];
  const inboxMessages = showNeedsReply
    ? needsReply.slice(0, 5)
    : (messages?.filter((message) => message.unread).slice(0, 5) ?? []);

  function todoTile(source: "tasks" | "reminders", result: SourceResult<unknown> | undefined) {
    const status = sourceStatusShort(result);
    if (!result || status) return { value: null, caption: status ?? "Loading…" };
    const items = openTodos.filter((todo) => todo.source === source);
    const overdue = items.filter((todo) => todo.dueDate && todo.dueDate < today).length;
    const dueToday = items.filter((todo) => todo.dueDate === today).length;
    const parts = [
      overdue ? `${overdue} overdue` : null,
      dueToday ? `${dueToday} due today` : null,
    ].filter(Boolean);
    return { value: items.length, caption: parts.length ? parts.join(" · ") : "Nothing due today" };
  }

  function mailTile() {
    const status = sourceStatusShort(mail.data);
    if (!messages || status) return { value: null, caption: status ?? "Loading…" };
    const unread = messages.filter((message) => message.unread).length;
    return {
      value: unread,
      caption: showNeedsReply
        ? `Unread · ${needsReply.length} need a reply`
        : `Unread of ${messages.length} recent`,
    };
  }

  function calendarTile() {
    const status = sourceStatusShort(calendar.data);
    if (!calendar.data || status) return { value: null, caption: status ?? "Loading…" };
    const next = todayEvents.find((event) => !event.allDay && !isEventPast(event));
    return {
      value: todayEvents.filter((event) => !isEventPast(event)).length,
      caption: next
        ? `${isEventNow(next) ? "Now" : formatTimeOfDay(next.start)} · ${next.title}`
        : "Nothing else today",
    };
  }

  const tiles = [
    on.tasks ? <SourceTile key="tasks" source="tasks" {...todoTile("tasks", tasks.data)} /> : null,
    on.reminders ? (
      <SourceTile key="reminders" source="reminders" {...todoTile("reminders", reminders.data)} />
    ) : null,
    on.mail ? <SourceTile key="mail" source="mail" {...mailTile()} /> : null,
    on.calendar ? <SourceTile key="calendar" source="calendar" {...calendarTile()} /> : null,
  ].filter(Boolean);

  const todoSources = (["tasks", "reminders"] as const).filter((source) => on[source]);

  return (
    <>
      <ScrollArea
        className="h-full"
        title="Today"
        subtitle={longToday()}
        actions={
          <ViewActions
            onRefresh={() => void queryClient.invalidateQueries()}
            refreshing={refreshing}
          />
        }
      >
        <div className="flex flex-col gap-8 px-6 pb-8 pt-2 w-full max-w-5xl mx-auto">
          {googleSourcesOn && google && !google.hasCredentials ? (
            <Callout
              color="blue"
              actions={
                <Button size="small" onClick={() => void openSettings()}>
                  Open Settings
                </Button>
              }
            >
              Set up Google to bring in Tasks, Gmail, and Calendar.
            </Callout>
          ) : googleSourcesOn && google && !google.connected ? (
            <Callout
              color="blue"
              actions={
                <Button
                  size="small"
                  onClick={() => connectGoogle.mutate()}
                  disabled={connectGoogle.isPending}
                >
                  {connectGoogle.isPending ? "Waiting for Browser…" : "Connect Google"}
                </Button>
              }
            >
              Your Google account isn't connected.
            </Callout>
          ) : null}
          {on.reminders && accounts.data?.reminders === "not-determined" ? (
            <Callout
              color="blue"
              actions={
                <Button
                  size="small"
                  onClick={() => requestReminders.mutate()}
                  disabled={requestReminders.isPending}
                >
                  Allow Access
                </Button>
              }
            >
              Allow access to include your Apple Reminders.
            </Callout>
          ) : null}

          {tiles.length ? (
            <div className={`grid gap-3 ${TILE_GRID[tiles.length]}`}>{tiles}</div>
          ) : null}

          {featureOn(settings, "assistant") ? (
            <AskAssistantCard provider={settings?.ai.provider ?? "glaze"} />
          ) : null}

          {featureOn(settings, "briefing") ? (
            <BriefingCard
              ready={!loadingSources}
              autoGenerate={featureOn(settings, "autoBriefing")}
              buildPrompt={() =>
                buildBriefingPrompt({
                  todos,
                  todosAvailable,
                  calendar: calendar.data,
                  mail: mail.data,
                  triage: triage.map,
                })
              }
            />
          ) : null}

          {todoSources.length || on.calendar ? (
            <div
              className={`grid grid-cols-1 gap-8 ${todoSources.length && on.calendar ? "xl:grid-cols-2" : ""}`}
            >
              {todoSources.length ? (
                <UpNextCard
                  todos={todos}
                  todayEvents={todayEvents}
                  sources={todoSources}
                  loading={tasks.isPending || reminders.isPending}
                  canPrioritize={featureOn(settings, "prioritize")}
                  hint={
                    todosAvailable
                      ? null
                      : "Connect Google Tasks or allow Reminders access to see what's next."
                  }
                />
              ) : null}

              {on.calendar ? (
                <SectionCard
                  title={<SourceHeading source="calendar">Schedule</SourceHeading>}
                  accessory={
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => void navigate({ to: "/calendar" })}
                    >
                      Calendar
                    </Button>
                  }
                >
                  {calendar.isPending ? (
                    <RowsSkeleton rows={3} />
                  ) : sourceHint(calendar.data, "your calendar") ? (
                    <InlineHint>{sourceHint(calendar.data, "your calendar")}</InlineHint>
                  ) : calendar.isError ? (
                    <InlineHint>Couldn't load your calendar.</InlineHint>
                  ) : todayEvents.length ? (
                    <ListCard>
                      {todayEvents.map((event) => (
                        <EventRow key={event.id} event={event} dot="calendar" />
                      ))}
                    </ListCard>
                  ) : (
                    <InlineHint>Nothing on the calendar today.</InlineHint>
                  )}
                </SectionCard>
              ) : null}
            </div>
          ) : null}

          {on.mail ? (
            <SectionCard
              title={
                <SourceHeading source="mail">
                  {showNeedsReply ? "Needs Reply" : "Unread Mail"}
                </SourceHeading>
              }
              accessory={
                <>
                  {triage.isRunning ? <Status variant="loading">Sorting…</Status> : null}
                  {triageOn ? (
                    <Button
                      size="small"
                      onClick={triage.isRunning ? triage.stop : triage.run}
                      disabled={!messages?.length}
                    >
                      {triage.isRunning
                        ? "Stop"
                        : triage.hasResults
                          ? "Re-sort Inbox"
                          : "Triage Inbox"}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    variant="transparent"
                    onClick={() => void navigate({ to: "/mail" })}
                  >
                    Mail
                  </Button>
                </>
              }
            >
              {triage.message ? <Callout color="orange">{triage.message}</Callout> : null}
              {triage.parseFailed ? (
                <Callout color="yellow">Couldn't read the AI's sorting. Try again.</Callout>
              ) : null}
              {mail.isPending ? (
                <RowsSkeleton rows={3} />
              ) : sourceHint(mail.data, "your inbox") ? (
                <InlineHint>{sourceHint(mail.data, "your inbox")}</InlineHint>
              ) : mail.isError ? (
                <InlineHint>Couldn't load your inbox.</InlineHint>
              ) : inboxMessages.length ? (
                <ListCard>
                  {inboxMessages.map((message) => (
                    <MailRow
                      key={message.id}
                      message={message}
                      triage={triageOn ? triage.map[message.id] : undefined}
                      onReply={setReplyTo}
                      compact
                    />
                  ))}
                </ListCard>
              ) : (
                <InlineHint>
                  {showNeedsReply ? "Nothing needs a reply right now." : "No unread mail."}
                </InlineHint>
              )}
            </SectionCard>
          ) : null}
        </div>
      </ScrollArea>
      <ReplyDialog
        key={replyTo?.id ?? "none"}
        message={replyTo}
        onOpenChange={(open) => !open && setReplyTo(null)}
      />
    </>
  );
}
