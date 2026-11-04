import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "@renderer/ui";
import type { MailItem, MailScheduleEntry, SourceResult } from "@main/shared-types";

import { errorMessage, invoke } from "./ipc";
import { queryKeys } from "./queries";
import { sourceOn, useSettings } from "./settings";

export const mailScheduleKey = ["mail-schedule"] as const;

/** Snoozed emails and follow-ups for this account, kept current by `mail:scheduleChanged`. */
export function useMailSchedule() {
  const queryClient = useQueryClient();
  const mailOn = sourceOn(useSettings().data, "mail");
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("mail:scheduleChanged", () => {
        void queryClient.invalidateQueries({ queryKey: mailScheduleKey });
      }),
    [queryClient],
  );
  return useQuery({
    queryKey: mailScheduleKey,
    queryFn: () => invoke<MailScheduleEntry[]>("mail:schedule"),
    enabled: mailOn,
    staleTime: 60_000,
  });
}

function scheduled(message: MailItem) {
  return {
    messageId: message.id,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from,
    fromEmail: message.fromEmail,
  };
}

export function useMailScheduleActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: mailScheduleKey });
  };
  const dropFromInbox = (id: string) =>
    queryClient.setQueryData<SourceResult<MailItem>>(queryKeys.mail, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter((item) => item.id !== id),
          }
        : previous,
    );

  const snooze = useMutation({
    mutationFn: ({ message, until }: { message: MailItem; until: Date; label: string }) =>
      invoke<MailScheduleEntry>("mail:snooze", {
        ...scheduled(message),
        until: until.getTime(),
      }),
    onSuccess: (_entry, { message, label }) => {
      dropFromInbox(message.id);
      refresh();
      toast.success(`Snoozed until ${label.toLowerCase()}`);
    },
    onError: (error) => toast.error(`Couldn't snooze: ${errorMessage(error)}`),
  });

  const unsnooze = useMutation({
    mutationFn: (messageId: string) => invoke("mail:unsnooze", { messageId }),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: queryKeys.mail });
      toast.success("Back in your inbox");
    },
    onError: (error) => toast.error(`Couldn't unsnooze: ${errorMessage(error)}`),
  });

  const followUp = useMutation({
    mutationFn: ({ message, days }: { message: MailItem; days: number }) =>
      invoke<MailScheduleEntry>("mail:followUp", {
        ...scheduled(message),
        days,
      }),
    onSuccess: (_entry, { days }) => {
      refresh();
      toast.success(
        `DayBoard will remind you if nobody replies in ${days} ${days === 1 ? "day" : "days"}`,
      );
    },
    onError: (error) => toast.error(`Couldn't set a reminder: ${errorMessage(error)}`),
  });

  const cancelFollowUp = useMutation({
    mutationFn: (messageId: string) => invoke("mail:cancelFollowUp", { messageId }),
    onSuccess: refresh,
    onError: (error) => toast.error(`Couldn't cancel the reminder: ${errorMessage(error)}`),
  });

  return { snooze, unsnooze, followUp, cancelFollowUp };
}

/** Follow-ups nobody answered in time, in the shape Home's "Needs you" takes. */
export function dueFollowUps(entries: MailScheduleEntry[] | undefined) {
  return (entries ?? [])
    .filter((entry) => entry.kind === "follow-up" && entry.due)
    .map((entry) => ({
      mail: entryMail(entry),
      since: entry.createdAt,
      days: Math.max(1, Math.round((entry.dueAt - entry.createdAt) / 86_400_000)),
    }));
}

/** The email behind a schedule entry, for views that list mail. */
export function entryMail(entry: MailScheduleEntry): MailItem {
  return {
    id: entry.messageId,
    threadId: entry.threadId,
    from: entry.from,
    fromEmail: entry.fromEmail,
    subject: entry.subject,
    snippet: "",
    date: new Date(entry.createdAt).toISOString(),
    unread: false,
  };
}
