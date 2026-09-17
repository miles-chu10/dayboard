import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Callout, ScrollArea, Status } from "@glaze/core/components";
import type { MailItem } from "@main/shared-types";

import { BriefingCard } from "../components/briefing-card";
import { EventRow } from "../components/event-row";
import { MailRow } from "../components/mail-row";
import { ReplyDialog } from "../components/reply-dialog";
import { InlineHint, ListCard, RowsSkeleton, SectionCard } from "../components/section-card";
import { sourceHint } from "../components/source-gate";
import { UpNextCard } from "../components/up-next-card";
import { ViewActions } from "../components/view-actions";
import { buildBriefingPrompt } from "../lib/ai-prompts";
import { eventDayKey, longToday, todayISO } from "../lib/dates";
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
import { buildTodos } from "../lib/todos";
import { useTriage } from "../lib/triage";

export function HomeView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();
  const connectGoogle = useConnectGoogle();
  const requestReminders = useRequestRemindersAccess();
  const [replyTo, setReplyTo] = useState<MailItem | null>(null);

  const todos = buildTodos(tasks.data, reminders.data);
  const today = todayISO();
  const todayEvents =
    calendar.data?.state === "ok" ? calendar.data.items.filter((event) => eventDayKey(event) === today) : [];
  const messages = mail.data?.state === "ok" ? mail.data.items : undefined;
  const triage = useTriage(messages);

  const google = accounts.data?.google;
  const todosAvailable = tasks.data?.state === "ok" || reminders.data?.state === "ok";
  const loadingSources = tasks.isPending || reminders.isPending || mail.isPending || calendar.isPending;
  const refreshing = tasks.isFetching || reminders.isFetching || mail.isFetching || calendar.isFetching;

  const needsReply = messages?.filter((message) => triage.map[message.id]?.category === "needs-reply") ?? [];
  const inboxMessages = triage.hasResults
    ? needsReply.slice(0, 5)
    : (messages?.filter((message) => message.unread).slice(0, 5) ?? []);

  return (
    <>
      <ScrollArea
        className="h-full"
        title="Today"
        subtitle={longToday()}
        actions={<ViewActions onRefresh={() => void queryClient.invalidateQueries()} refreshing={refreshing} />}
      >
        <div className="flex flex-col gap-8 px-6 pb-8 pt-2 w-full max-w-5xl mx-auto">
          {google && !google.hasCredentials ? (
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
          ) : google && !google.connected ? (
            <Callout
              color="blue"
              actions={
                <Button size="small" onClick={() => connectGoogle.mutate()} disabled={connectGoogle.isPending}>
                  {connectGoogle.isPending ? "Waiting for Browser…" : "Connect Google"}
                </Button>
              }
            >
              Your Google account isn't connected.
            </Callout>
          ) : null}
          {accounts.data?.reminders === "not-determined" ? (
            <Callout
              color="blue"
              actions={
                <Button size="small" onClick={() => requestReminders.mutate()} disabled={requestReminders.isPending}>
                  Allow Access
                </Button>
              }
            >
              Allow access to include your Apple Reminders.
            </Callout>
          ) : null}

          <BriefingCard
            ready={!loadingSources}
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <UpNextCard
              todos={todos}
              todayEvents={todayEvents}
              loading={tasks.isPending || reminders.isPending}
              hint={todosAvailable ? null : "Connect Google Tasks or allow Reminders access to see what's next."}
            />

            <SectionCard
              title="Schedule"
              accessory={
                <Button size="small" variant="transparent" onClick={() => void navigate({ to: "/calendar" })}>
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
                    <EventRow key={event.id} event={event} />
                  ))}
                </ListCard>
              ) : (
                <InlineHint>Nothing on the calendar today.</InlineHint>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title={triage.hasResults ? "Needs Reply" : "Unread Mail"}
            accessory={
              <>
                {triage.isRunning ? <Status variant="loading">Sorting…</Status> : null}
                <Button
                  size="small"
                  onClick={triage.isRunning ? triage.stop : triage.run}
                  disabled={!messages?.length}
                >
                  {triage.isRunning ? "Stop" : triage.hasResults ? "Re-sort Inbox" : "Triage Inbox"}
                </Button>
                <Button size="small" variant="transparent" onClick={() => void navigate({ to: "/mail" })}>
                  Mail
                </Button>
              </>
            }
          >
            {triage.message ? <Callout color="orange">{triage.message}</Callout> : null}
            {triage.parseFailed ? <Callout color="yellow">Couldn't read the AI's sorting. Try again.</Callout> : null}
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
                    triage={triage.map[message.id]}
                    onReply={setReplyTo}
                    compact
                  />
                ))}
              </ListCard>
            ) : (
              <InlineHint>{triage.hasResults ? "Nothing needs a reply right now." : "No unread mail."}</InlineHint>
            )}
          </SectionCard>
        </div>
      </ScrollArea>
      <ReplyDialog key={replyTo?.id ?? "none"} message={replyTo} onOpenChange={(open) => !open && setReplyTo(null)} />
    </>
  );
}
