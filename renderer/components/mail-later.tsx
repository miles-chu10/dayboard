import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Kbd,
  Text,
} from "@renderer/ui";
import type { ReactNode } from "react";
import { BellRing, Clock } from "lucide-react";
import type { MailItem, MailScheduleEntry } from "@main/shared-types";

import { ListCard } from "./section-card";

import { useMailSchedule, useMailScheduleActions } from "../lib/mail-schedule";
import { useSettings } from "../lib/settings";
import { FOLLOW_UP_CHOICES, formatSnoozeTime, snoozeOptions } from "../lib/snooze";

/** Snooze until a time (S); the email leaves the inbox and comes back unread. */
export function SnoozeMenu({
  message,
  open,
  onOpenChange,
  onSnoozed,
}: {
  message: MailItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnoozed?: () => void;
}) {
  const { snooze } = useMailScheduleActions();
  const now = new Date();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button size="small" variant="transparent" disabled={snooze.isPending}>
          <Clock />
          Snooze
          <Kbd>S</Kbd>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
        {snoozeOptions(now).map((option) => (
          <DropdownMenuItem
            key={option.label}
            accelerator={formatSnoozeTime(option.until, now)}
            onSelect={() =>
              snooze.mutate(
                { message, until: option.until, label: option.label },
                { onSuccess: () => onSnoozed?.() },
              )
            }
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Remind me if no reply": brings the thread back to Home when nobody answers in time. */
export function FollowUpMenu({ message }: { message: MailItem }) {
  const settings = useSettings().data;
  const schedule = useMailSchedule();
  const { followUp, cancelFollowUp } = useMailScheduleActions();
  const existing = schedule.data?.find(
    (entry) => entry.kind === "follow-up" && entry.messageId === message.id,
  );
  if (existing)
    return (
      <Button
        size="small"
        variant="transparent"
        disabled={cancelFollowUp.isPending}
        onClick={() => cancelFollowUp.mutate(message.id)}
        title="Stop waiting for a reply"
      >
        <BellRing />
        {existing.due ? "No reply yet · Dismiss" : "Waiting for reply · Cancel"}
      </Button>
    );
  const preferred = settings?.mail.followUpDays ?? 3;
  const choices = [...new Set([preferred, ...FOLLOW_UP_CHOICES])].sort((a, b) => a - b);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="small" variant="transparent" disabled={followUp.isPending}>
          <BellRing />
          Remind me
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>If nobody replies in</DropdownMenuLabel>
        {choices.map((days) => (
          <DropdownMenuItem
            key={days}
            accelerator={days === preferred ? "Default" : undefined}
            onSelect={() => followUp.mutate({ message, days })}
          >
            {days} {days === 1 ? "day" : "days"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScheduleSection({
  title,
  entries,
  render,
}: {
  title: string;
  entries: MailScheduleEntry[];
  render: (entry: MailScheduleEntry) => ReactNode;
}) {
  if (!entries.length) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <Text variant="strong" as="h2" className="px-1">
        {title}{" "}
        <Text as="span" color="secondary">
          {entries.length}
        </Text>
      </Text>
      <ListCard>
        {entries.map((entry) => (
          <div
            key={`${entry.kind}:${entry.messageId}`}
            className="flex min-w-0 items-center gap-3 px-3 py-2"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <Text truncate>{entry.subject || "(no subject)"}</Text>
              <Text variant="small" color="secondary" truncate>
                {entry.from}
              </Text>
            </div>
            {render(entry)}
          </div>
        ))}
      </ListCard>
    </section>
  );
}

/** The Inbox's "Later" lists: snoozed emails and emails waiting for a reply. */
export function ScheduledMail() {
  const schedule = useMailSchedule();
  const { unsnooze, cancelFollowUp } = useMailScheduleActions();
  const entries = schedule.data ?? [];
  if (!entries.length) return null;
  const now = new Date();
  const snoozed = entries
    .filter((entry) => entry.kind === "snooze")
    .sort((a, b) => a.dueAt - b.dueAt);
  const waiting = entries
    .filter((entry) => entry.kind === "follow-up")
    .sort((a, b) => Number(b.due ?? false) - Number(a.due ?? false) || a.dueAt - b.dueAt);
  return (
    <>
      <ScheduleSection
        title="Snoozed"
        entries={snoozed}
        render={(entry) => (
          <>
            <Text variant="small" color="secondary" className="shrink-0 tabular-nums">
              {formatSnoozeTime(new Date(entry.dueAt), now)}
            </Text>
            <Button
              size="small"
              variant="transparent"
              disabled={unsnooze.isPending}
              aria-label={`Unsnooze ${entry.subject}`}
              onClick={() => unsnooze.mutate(entry.messageId)}
            >
              Unsnooze
            </Button>
          </>
        )}
      />
      <ScheduleSection
        title="Waiting for reply"
        entries={waiting}
        render={(entry) => (
          <>
            <Text
              variant="small"
              color={entry.due ? "orange" : "secondary"}
              className="shrink-0 tabular-nums"
            >
              {entry.due ? "No reply yet" : `Until ${formatSnoozeTime(new Date(entry.dueAt), now)}`}
            </Text>
            <Button
              size="small"
              variant="transparent"
              disabled={cancelFollowUp.isPending}
              aria-label={`Stop waiting on ${entry.subject}`}
              onClick={() => cancelFollowUp.mutate(entry.messageId)}
            >
              {entry.due ? "Dismiss" : "Cancel"}
            </Button>
          </>
        )}
      />
    </>
  );
}
