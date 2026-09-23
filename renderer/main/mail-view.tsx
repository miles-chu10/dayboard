import { useState } from "react";
import {
  Button,
  Callout,
  EmptyState,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Status,
} from "@renderer/ui";
import { RotateCw, Sparkles, Square } from "lucide-react";
import type { MailItem } from "@main/shared-types";

import { MailDetail } from "../components/mail-detail";
import { MailRow } from "../components/mail-row";
import { ReplyDialog } from "../components/reply-dialog";
import { ListCard } from "../components/section-card";
import { HistoryNav } from "../components/history-nav";
import { SourceHeading } from "../components/source-dot";
import { SourceGate } from "../components/source-gate";
import { useMail } from "../lib/queries";
import { featureOn, useSettings } from "../lib/settings";
import { useTriage, type TriageCategory } from "../lib/triage";

type MailFilter = "all" | TriageCategory;

export function MailView() {
  const mail = useMail();
  const settings = useSettings().data;
  const triageOn = featureOn(settings, "triage");
  const detailView = settings?.general.detailView ?? "dialog";
  const messages = mail.data?.state === "ok" ? mail.data.items : undefined;
  const triage = useTriage(messages);
  const [filter, setFilter] = useState<MailFilter>("all");
  const [replyTo, setReplyTo] = useState<MailItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const unread = messages?.filter((message) => message.unread).length ?? 0;
  const countFor = (category: TriageCategory) =>
    messages?.filter((message) => triage.map[message.id]?.category === category).length ?? 0;
  const activeFilter: MailFilter = triageOn ? filter : "all";
  const selected = messages?.find((message) => message.id === selectedId);

  function toggleOpen(message: MailItem) {
    setSelectedId((current) => (current === message.id ? undefined : message.id));
  }

  function renderDetail(presentation: "dialog" | "panel") {
    if (!selected) return null;
    return (
      <MailDetail
        key={selected.id}
        message={selected}
        triage={triageOn ? triage.map[selected.id] : undefined}
        presentation={presentation}
        onClose={() => setSelectedId(undefined)}
        onReply={setReplyTo}
      />
    );
  }

  const sidePanel = detailView === "sidebar" ? renderDetail("panel") : null;

  return (
    <>
      <div className="flex h-full min-w-0">
        <div className="h-full min-w-0 flex-1">
          <ScrollArea
            className="h-full"
            leading={<HistoryNav />}
            title={<SourceHeading source="mail">Gmail</SourceHeading>}
            subtitle={messages ? `${messages.length} recent · ${unread} unread` : "Gmail"}
            actions={
              <>
                {triageOn ? (
                  <Button
                    iconOnly
                    aria-label={triage.isRunning ? "Stop sorting" : "Triage inbox with AI"}
                    title={triage.isRunning ? "Stop sorting" : "Triage inbox with AI"}
                    onClick={triage.isRunning ? triage.stop : triage.run}
                    disabled={!messages?.length}
                  >
                    {triage.isRunning ? <Square /> : <Sparkles />}
                  </Button>
                ) : null}
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
            <div className="flex flex-col gap-[var(--density-page-gap)] px-6 pb-8 pt-1 w-full max-w-4xl mx-auto">
              <SourceGate query={mail} label="Gmail inbox">
                {(items) => {
                  const filtered =
                    activeFilter === "all"
                      ? items
                      : items.filter(
                          (message) => triage.map[message.id]?.category === activeFilter,
                        );
                  return (
                    <>
                      {triageOn ? (
                        <>
                          <div className="flex items-center gap-3 min-h-8">
                            <SegmentedControl
                              size="small"
                              value={activeFilter}
                              onValueChange={(value: string) => setFilter(value as MailFilter)}
                              aria-label="Filter inbox"
                            >
                              <SegmentedControlItem value="all">All</SegmentedControlItem>
                              <SegmentedControlItem value="needs-reply">
                                Needs Reply {countFor("needs-reply")}
                              </SegmentedControlItem>
                              <SegmentedControlItem value="fyi">
                                FYI {countFor("fyi")}
                              </SegmentedControlItem>
                              <SegmentedControlItem value="ignore">
                                Ignorable {countFor("ignore")}
                              </SegmentedControlItem>
                            </SegmentedControl>
                            {triage.isRunning ? (
                              <Status variant="loading">Sorting inbox…</Status>
                            ) : null}
                          </div>
                          {triage.message ? (
                            <Callout color="orange">{triage.message}</Callout>
                          ) : null}
                          {triage.parseFailed ? (
                            <Callout color="yellow">
                              Couldn't read the AI's sorting. Try again.
                            </Callout>
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
                              Sort your inbox into needs reply, FYI, and ignorable, and spot emails
                              that are really tasks.
                            </Callout>
                          ) : null}
                        </>
                      ) : null}
                      {filtered.length ? (
                        <ListCard>
                          {filtered.map((message) => (
                            <div key={message.id}>
                              <MailRow
                                message={message}
                                triage={triageOn ? triage.map[message.id] : undefined}
                                onReply={setReplyTo}
                                onOpen={toggleOpen}
                                selected={selectedId === message.id}
                              />
                              {detailView === "inline" && selectedId === message.id
                                ? renderDetail("panel")
                                : null}
                            </div>
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
        </div>
        {sidePanel ? (
          <aside
            aria-label="Email details"
            className="h-full w-[min(380px,40%)] shrink-0 overflow-y-auto border-l border-separator px-3 pb-6 pt-14"
          >
            {sidePanel}
          </aside>
        ) : null}
      </div>
      {detailView === "dialog" ? renderDetail("dialog") : null}
      <ReplyDialog
        key={replyTo?.id ?? "none"}
        message={replyTo}
        onOpenChange={(open) => !open && setReplyTo(null)}
      />
    </>
  );
}
