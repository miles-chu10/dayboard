import { useEffect, useEffectEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, Field, FieldGroup, Kbd, Status, Text, toast } from "@renderer/ui";
import { Archive, ExternalLink, ListPlus, Reply, Sparkles } from "lucide-react";
import { isTypingTarget } from "../lib/shortcuts";
import type { MailItem, SourceResult } from "@main/shared-types";

import { formatMailDate } from "../lib/dates";
import { errorMessage, invoke, openExternal } from "../lib/ipc";
import { queryKeys, useAccounts } from "../lib/queries";
import { TRIAGE_LABEL, type TriageResult } from "../lib/triage";
import { DetailPanel } from "./detail-panel";
import { FollowUpMenu, SnoozeMenu } from "./mail-later";

export function MailDetail({
  message,
  triage,
  presentation,
  onClose,
  onReply,
}: {
  message: MailItem;
  triage?: TriageResult;
  presentation: "dialog" | "panel";
  onClose: () => void;
  onReply: (message: MailItem) => void;
}) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const email = accounts.data?.google.email;
  const gmailUrl = `https://mail.google.com/mail/${email ? `?authuser=${encodeURIComponent(email)}` : ""}#all/${message.threadId}`;
  const badge = triage ? TRIAGE_LABEL[triage.category] : null;

  const body = useQuery({
    queryKey: ["mail-body", message.id],
    queryFn: () => invoke<{ text: string }>("mail:getBody", { id: message.id }),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!message.unread) return;
    void invoke("mail:markRead", { id: message.id })
      .then(() => {
        queryClient.setQueryData<SourceResult<MailItem>>(queryKeys.mail, (prev) =>
          prev?.state === "ok"
            ? {
                ...prev,
                items: prev.items.map((item) =>
                  item.id === message.id ? { ...item, unread: false } : item,
                ),
              }
            : prev,
        );
      })
      .catch(() => undefined);
  }, [message.id, message.unread, queryClient]);

  const archive = useMutation({
    mutationFn: () => invoke("mail:archive", { id: message.id }),
    onSuccess: () => {
      queryClient.setQueryData<SourceResult<MailItem>>(queryKeys.mail, (prev) =>
        prev?.state === "ok"
          ? {
              ...prev,
              items: prev.items.filter((item) => item.id !== message.id),
            }
          : prev,
      );
      toast.success("Archived");
      onClose();
    },
    onError: (error) => toast.error(`Couldn't archive: ${errorMessage(error)}`),
  });

  const addTask = useMutation({
    mutationFn: (title: string) =>
      invoke("tasks:create", {
        title,
        notes: `From email: ${message.subject}\n${gmailUrl}`,
      }),
    onSuccess: (_data, title) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast.success(`Added “${title}” to Google Tasks`);
    },
    onError: (error) => toast.error(`Couldn't add task: ${errorMessage(error)}`),
  });

  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // E marks the email done (archives it), R replies and S snoozes, as in HeroSpace and Gmail.
  const keyActions = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.defaultPrevented)
      return;
    // Only while this email is the topmost thing: no other dialog over it.
    const ownDialogs = presentation === "dialog" ? 1 : 0;
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length;
    if (isTypingTarget(event.target) || dialogs > ownDialogs) return;
    const key = event.key.toLowerCase();
    if (key === "e" && !event.shiftKey && !archive.isPending) {
      event.preventDefault();
      archive.mutate();
    } else if (key === "r" && !event.shiftKey) {
      event.preventDefault();
      if (presentation === "dialog") onClose();
      onReply(message);
    } else if (key === "s" && !event.shiftKey) {
      event.preventDefault();
      setSnoozeOpen(true);
    }
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => keyActions(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const content = (
    <div className="flex flex-col gap-4">
      {triage ? (
        <section
          aria-label="Summary"
          className="flex items-start gap-3 rounded-xl border border-separator bg-well px-3 py-2.5"
        >
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-secondary" />
          <div className="flex min-w-0 flex-1 flex-col">
            <Text variant="strong">{badge?.label}</Text>
            {triage.reason ? (
              <Text color="secondary" className="break-words">
                {triage.reason}
              </Text>
            ) : null}
          </div>
          <Button size="small" disabled={archive.isPending} onClick={() => archive.mutate()}>
            Mark done
            <Kbd>E</Kbd>
          </Button>
        </section>
      ) : null}
      <FieldGroup>
        <Field label="From" orientation="vertical">
          <div className="flex items-center gap-2 min-w-0">
            <Text className="min-w-0 break-words">{message.from}</Text>
            {badge ? (
              <Badge color={badge.color} className="shrink-0">
                {badge.label}
              </Badge>
            ) : null}
          </div>
        </Field>
        <Field label="Received" orientation="vertical">
          <Text>{formatMailDate(message.date)}</Text>
        </Field>
        <Field label="Message" orientation="vertical">
          {body.isPending ? (
            <Status variant="loading">Loading message…</Status>
          ) : body.isError ? (
            <Text variant="small" color="red">
              {errorMessage(body.error)}
            </Text>
          ) : (
            <Text className="whitespace-pre-wrap break-words">
              {body.data?.text?.trim() || message.snippet}
            </Text>
          )}
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button
          size="small"
          onClick={() => {
            if (presentation === "dialog") onClose();
            onReply(message);
          }}
        >
          <Reply />
          Reply
        </Button>
        {triage?.task ? (
          <Button
            size="small"
            variant="transparent"
            disabled={addTask.isPending || addTask.isSuccess}
            onClick={() => addTask.mutate(triage.task)}
          >
            <ListPlus />
            Add task
          </Button>
        ) : null}
        <Button
          size="small"
          variant="transparent"
          disabled={archive.isPending}
          onClick={() => archive.mutate()}
        >
          <Archive />
          Archive
        </Button>
        <SnoozeMenu
          message={message}
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          onSnoozed={onClose}
        />
        <FollowUpMenu message={message} />
        <Button size="small" variant="transparent" onClick={() => void openExternal(gmailUrl)}>
          <ExternalLink />
          Open in Gmail
        </Button>
      </div>
    </div>
  );

  if (presentation === "dialog") {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        size="large"
        title={message.subject || "(No subject)"}
        description={message.from}
        confirmLabel="Done"
        onConfirm={onClose}
      >
        {content}
      </Dialog>
    );
  }

  return (
    <DetailPanel
      title={message.subject || "(No subject)"}
      subtitle={message.from}
      onClose={onClose}
    >
      {content}
    </DetailPanel>
  );
}
