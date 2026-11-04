import { DetailsLayout } from "../components/details-layout";
import { useEffect, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { isTypingTarget, stepRow } from "../lib/shortcuts";
import { useCompose } from "../components/compose-dialog";
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
import { SourceHeading } from "../components/source-dot";
import { SourceGate } from "../components/source-gate";
import { HistoryNav } from "../components/history-nav";
import { WindowActions } from "../components/view-actions";
import { useMail } from "../lib/queries";
import { autoTriageOn, featureOn, useSettings } from "../lib/settings";
import { useAutoTriage, useTriage, type TriageCategory } from "../lib/triage";
import { contextItemKey } from "../lib/agent-context";
import { usePublishViewContext } from "../components/shell";

type MailFilter = "all" | TriageCategory;

export function MailView() {
  const mail = useMail();
  const settings = useSettings().data;
  const triageOn = featureOn(settings, "triage");
  const detailView = settings?.general.detailView ?? "dialog";
  const messages = mail.data?.state === "ok" ? mail.data.items : undefined;
  const triage = useTriage(messages);
  useAutoTriage(triage, messages, autoTriageOn(settings));

  const { openCompose } = useCompose();
  const openComposeRef = useRef(() => openCompose());
  useEffect(() => {
    openComposeRef.current = () => openCompose();
  });

  // J/K move between emails outside text fields, as in Gmail; ↩ opens the focused one; C writes.
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const rows = [
        ...document.querySelectorAll<HTMLElement>("[data-window-content] [data-mail-open]"),
      ];
      const next = stepRow(
        rows.findIndex((row) => row === document.activeElement),
        rows.length,
        event.key,
      );
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        openComposeRef.current();
        return;
      }
      if (next === null) return;
      event.preventDefault();
      rows[next].focus();
      rows[next].scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const [filter, setFilter] = useState<MailFilter>("all");
  const [replyTo, setReplyTo] = useState<MailItem | null>(null);
  const { item: requestedId } = useSearch({ from: "/mail" });
  const [selectedId, setSelectedId] = useState<string | undefined>(requestedId);
  // A message requested later (⌘K while Inbox is open) replaces the selection once.
  const [lastRequested, setLastRequested] = useState(requestedId);
  if (requestedId !== lastRequested) {
    setLastRequested(requestedId);
    if (requestedId) setSelectedId(requestedId);
  }

  const unread = messages?.filter((message) => message.unread).length ?? 0;
  const countFor = (category: TriageCategory) =>
    messages?.filter((message) => triage.map[message.id]?.category === category).length ?? 0;
  const activeFilter: MailFilter = triageOn ? filter : "all";
  const selected = messages?.find((message) => message.id === selectedId);
  usePublishViewContext({
    view: "mail",
    title: "Inbox",
    itemKey: contextItemKey({ mail: selected }),
  });

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
      <DetailsLayout
        details={sidePanel}
        selectedKey={selectedId ? `mail:${selectedId}` : undefined}
        storageKey="mail"
        label="Email details"
      >
        <ScrollArea
          className="h-full"
          leading={<HistoryNav />}
          viewportClassName="[&>div]:block!"
          title={<SourceHeading source="mail">Gmail</SourceHeading>}
          subtitle={messages ? `${messages.length} recent · ${unread} unread` : "Gmail"}
          actions={
            <>
              <WindowActions />
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
          <div className="flex flex-col gap-[var(--density-page-gap)] px-6 pb-8 pt-1 w-full max-w-5xl mx-auto">
            <div data-inline-details />
            <SourceGate query={mail} label="Gmail inbox">
              {(items) => {
                const filtered =
                  activeFilter === "all"
                    ? items
                    : items.filter((message) => triage.map[message.id]?.category === activeFilter);
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
                        {triage.message ? <Callout color="orange">{triage.message}</Callout> : null}
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
      </DetailsLayout>
      {detailView === "dialog" ? renderDetail("dialog") : null}
      <ReplyDialog
        key={replyTo?.id ?? "none"}
        message={replyTo}
        onOpenChange={(open) => !open && setReplyTo(null)}
      />
    </>
  );
}
