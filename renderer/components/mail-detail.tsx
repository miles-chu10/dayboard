import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  Field,
  FieldGroup,
  Status,
  Text,
  toast,
} from "@glaze/core/components";
import { Archive, ExternalLink, ListPlus, Reply } from "lucide-react";
import type { MailItem, SourceResult } from "@main/shared-types";

import { formatMailDate } from "../lib/dates";
import { errorMessage, invoke, openExternal } from "../lib/ipc";
import { queryKeys, useAccounts } from "../lib/queries";
import { TRIAGE_LABEL, type TriageResult } from "../lib/triage";
import { DetailPanel } from "./detail-panel";

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
          ? { ...prev, items: prev.items.filter((item) => item.id !== message.id) }
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

  const content = (
    <div className="flex flex-col gap-4">
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
        {triage?.reason ? (
          <Field label="Why it matters" orientation="vertical">
            <Text className="break-words">{triage.reason}</Text>
          </Field>
        ) : null}
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
