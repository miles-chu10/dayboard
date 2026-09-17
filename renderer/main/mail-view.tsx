import { useState } from "react";
import {
  Button,
  Callout,
  EmptyState,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Status,
} from "@glaze/core/components";
import { RotateCw, Sparkles, Square } from "lucide-react";
import type { MailItem } from "@main/shared-types";

import { MailRow } from "../components/mail-row";
import { ReplyDialog } from "../components/reply-dialog";
import { ListCard } from "../components/section-card";
import { SourceGate } from "../components/source-gate";
import { useMail } from "../lib/queries";
import { useTriage, type TriageCategory } from "../lib/triage";

type MailFilter = "all" | TriageCategory;

export function MailView() {
  const mail = useMail();
  const messages = mail.data?.state === "ok" ? mail.data.items : undefined;
  const triage = useTriage(messages);
  const [filter, setFilter] = useState<MailFilter>("all");
  const [replyTo, setReplyTo] = useState<MailItem | null>(null);

  const unread = messages?.filter((message) => message.unread).length ?? 0;
  const countFor = (category: TriageCategory) =>
    messages?.filter((message) => triage.map[message.id]?.category === category).length ?? 0;

  return (
    <>
      <ScrollArea
        className="h-full"
        title="Mail"
        subtitle={messages ? `${messages.length} in inbox · ${unread} unread` : "Gmail"}
        actions={
          <>
            <Button
              iconOnly
              aria-label={triage.isRunning ? "Stop sorting" : "Triage inbox with AI"}
              title={triage.isRunning ? "Stop sorting" : "Triage inbox with AI"}
              onClick={triage.isRunning ? triage.stop : triage.run}
              disabled={!messages?.length}
            >
              {triage.isRunning ? <Square /> : <Sparkles />}
            </Button>
            <Button
              iconOnly
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void mail.refetch()}
              disabled={mail.isFetching}
            >
              <RotateCw />
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
          <SourceGate query={mail} label="Gmail inbox">
            {(items) => {
              const filtered =
                filter === "all"
                  ? items
                  : items.filter((message) => triage.map[message.id]?.category === filter);
              return (
                <>
                  <div className="flex items-center gap-3 min-h-8">
                    <SegmentedControl
                      size="small"
                      value={filter}
                      onValueChange={(value) => setFilter(value as MailFilter)}
                      aria-label="Filter inbox"
                    >
                      <SegmentedControlItem value="all">All</SegmentedControlItem>
                      <SegmentedControlItem value="needs-reply">
                        Needs Reply {countFor("needs-reply")}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="fyi">FYI {countFor("fyi")}</SegmentedControlItem>
                      <SegmentedControlItem value="ignore">
                        Ignorable {countFor("ignore")}
                      </SegmentedControlItem>
                    </SegmentedControl>
                    {triage.isRunning ? <Status variant="loading">Sorting inbox…</Status> : null}
                  </div>
                  {triage.message ? <Callout color="orange">{triage.message}</Callout> : null}
                  {triage.parseFailed ? (
                    <Callout color="yellow">Couldn't read the AI's sorting. Try again.</Callout>
                  ) : null}
                  {!triage.hasResults && !triage.isRunning && items.length ? (
                    <Callout
                      color="blue"
                      icon={<Sparkles />}
                      actions={
                        <Button size="small" onClick={triage.run}>
                          Triage Inbox
                        </Button>
                      }
                    >
                      Sort your inbox into needs reply, FYI, and ignorable, and spot emails that are
                      really tasks.
                    </Callout>
                  ) : null}
                  {filtered.length ? (
                    <ListCard>
                      {filtered.map((message) => (
                        <MailRow
                          key={message.id}
                          message={message}
                          triage={triage.map[message.id]}
                          onReply={setReplyTo}
                        />
                      ))}
                    </ListCard>
                  ) : (
                    <EmptyState
                      placement="inline"
                      className="py-16"
                      title={items.length ? "Nothing Here" : "Inbox Zero"}
                      description={
                        items.length
                          ? "No emails match this filter yet."
                          : "Your Gmail inbox is empty."
                      }
                    />
                  )}
                </>
              );
            }}
          </SourceGate>
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
