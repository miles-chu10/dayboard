import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Text, toast } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { Archive, ExternalLink, ListPlus, Reply } from "lucide-react";
import type { MailItem, SourceResult } from "@main/shared-types";

import { formatMailDate } from "../lib/dates";
import { errorMessage, invoke, openExternal } from "../lib/ipc";
import { queryKeys, useAccounts } from "../lib/queries";
import { TRIAGE_LABEL, type TriageResult } from "../lib/triage";
import { SourceDot } from "./source-dot";

const CHIP_DOT: Record<TriageResult["category"], string> = {
  "needs-reply": "bg-support-orange",
  fyi: "bg-support-blue",
  ignore: "bg-tertiary",
};

/** Triage's one-line take on the email, HeroSpace-style, beside its subject. */
export function TriageChip({ triage }: { triage: TriageResult }) {
  return (
    <span
      title={triage.reason}
      className="inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full bg-control px-2 py-0.5 text-small text-secondary"
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", CHIP_DOT[triage.category])}
      />
      <span className="truncate">{triage.reason}</span>
    </span>
  );
}

export function MailRow({
  message,
  triage,
  onReply,
  onOpen,
  selected,
  compact,
}: {
  message: MailItem;
  triage?: TriageResult;
  onReply: (message: MailItem) => void;
  onOpen?: (message: MailItem) => void;
  selected?: boolean;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const email = accounts.data?.google.email;

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

  const gmailUrl = `https://mail.google.com/mail/${email ? `?authuser=${encodeURIComponent(email)}` : ""}#all/${message.threadId}`;
  const badge = triage ? TRIAGE_LABEL[triage.category] : null;

  return (
    <div data-detail-anchor={`mail:${message.id}`}>
      <div
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-expanded={onOpen ? selected : undefined}
        aria-label={onOpen ? `Open email from ${message.from}` : undefined}
        data-mail-open={onOpen ? "" : undefined}
        onClick={onOpen ? () => onOpen(message) : undefined}
        onKeyDown={
          onOpen
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(message);
                }
              }
            : undefined
        }
        className={cn(
          "flex items-start gap-3 px-3 py-[var(--density-mail-py)] min-w-0",
          onOpen &&
            "cursor-default hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
          selected && "bg-list-selection",
        )}
      >
        <span className="mt-1.5 flex" title={message.unread ? "Unread" : "Read"}>
          <SourceDot source="mail" hollow={!message.unread} />
        </span>
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <Text
              variant={message.unread ? "strong" : "regular"}
              truncate
              className={cn("min-w-0", selected && "font-semibold")}
            >
              {message.from}
            </Text>
            {badge ? (
              <Badge color={badge.color} className="shrink-0">
                {badge.label}
              </Badge>
            ) : null}
            <Text variant="small" color="tertiary" className="ml-auto shrink-0 tabular-nums">
              {formatMailDate(message.date)}
            </Text>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Text variant="small" color="secondary" truncate className="min-w-0">
              {message.subject}
            </Text>
            {triage?.reason ? <TriageChip triage={triage} /> : null}
          </div>
          {!compact ? (
            <Text variant="small" color="tertiary" truncate>
              {message.snippet}
            </Text>
          ) : null}
        </div>
        <div
          className="flex items-center gap-0.5 shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button
            size="small"
            variant="transparent"
            iconOnly
            aria-label="Reply"
            title="Reply"
            onClick={() => onReply(message)}
          >
            <Reply />
          </Button>
          {triage?.task ? (
            <Button
              size="small"
              variant="transparent"
              iconOnly
              aria-label={`Add task: ${triage.task}`}
              title={`Add task: ${triage.task}`}
              disabled={addTask.isPending || addTask.isSuccess}
              onClick={() => addTask.mutate(triage.task)}
            >
              <ListPlus />
            </Button>
          ) : null}
          {!compact ? (
            <Button
              size="small"
              variant="transparent"
              iconOnly
              aria-label="Archive"
              title="Archive"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              <Archive />
            </Button>
          ) : null}
          <Button
            size="small"
            variant="transparent"
            iconOnly
            aria-label="Open in Gmail"
            title="Open in Gmail"
            onClick={() => void openExternal(gmailUrl)}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>
    </div>
  );
}
