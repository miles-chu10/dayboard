import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Callout, Dialog, Input, Status, Text, Textarea, toast } from "@renderer/ui";
import type { MailItem } from "@main/shared-types";

import { useAITask } from "../lib/ai";
import { learnFromDraft } from "../lib/agent-data";
import { REPLY_SYSTEM, buildReplyPrompt } from "../lib/ai-prompts";
import { errorMessage, invoke } from "../lib/ipc";
import { useAccounts } from "../lib/queries";
import { featureOn, useSettings } from "../lib/settings";
import { useCompose } from "./compose-dialog";

/** Render with `key={message?.id}` so each message starts with fresh state. */
export function ReplyDialog({
  message,
  onOpenChange,
}: {
  message: MailItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const accounts = useAccounts();
  const settings = useSettings().data;
  const aiReplies = featureOn(settings, "replyDrafts");
  const memoryOn = settings?.ai.memory === true;
  const ai = useAITask();
  const { sendMail, openCompose } = useCompose();
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState("");

  const body = useQuery({
    queryKey: ["mail-body", message?.id],
    queryFn: () => invoke<{ text: string }>("mail:getBody", { id: message!.id }),
    enabled: message !== null,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!ai.isDone) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDraft(ai.output.trim());
    });
    return () => {
      cancelled = true;
    };
  }, [ai.isDone, ai.output]);

  if (!message) return null;

  function write() {
    if (!message || !body.data) return;
    void ai.run({
      system: REPLY_SYSTEM,
      prompt: buildReplyPrompt({
        userEmail: accounts.data?.google.email ?? null,
        message,
        body: body.data.text,
        instructions,
      }),
      maxOutputTokens: 600,
      memory: true,
    });
  }

  async function save() {
    if (!message) return;
    try {
      await invoke("mail:createDraft", { id: message.id, body: draft });
      toast.success("Draft saved in Gmail");
    } catch (error) {
      toast.error(`Couldn't save draft: ${errorMessage(error)}`);
      throw error;
    }
  }

  async function send() {
    if (!message) return;
    const sent = message;
    const body = draft;
    const written = ai.isDone ? ai.output.trim() : "";
    try {
      await sendMail({ kind: "reply", id: sent.id, body }, () =>
        openCompose({
          replyToId: sent.id,
          heading: `Reply to ${sent.from}`,
          subject: sent.subject,
          body,
        }),
      );
      if (memoryOn && written) learnFromDraft(written, body);
      onOpenChange(false);
    } catch (error) {
      toast.error(`Couldn't send: ${errorMessage(error)}`);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) ai.stop();
        onOpenChange(open);
      }}
      size="large"
      title={`Reply to ${message.from}`}
      description={message.subject}
      confirmLabel="Send"
      confirmDisabled={!draft.trim() || ai.isRunning}
      onConfirm={send}
      secondaryAction={{
        label: "Save Draft",
        onClick: () => (draft.trim() && !ai.isRunning ? save().catch(() => undefined) : undefined),
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-well px-3 py-2 max-h-36 overflow-y-auto">
          {body.isPending ? (
            <Status variant="loading">Loading message…</Status>
          ) : body.isError ? (
            <Text variant="small" color="red">
              {errorMessage(body.error)}
            </Text>
          ) : (
            <Text variant="small" color="secondary" as="p" className="whitespace-pre-wrap">
              {body.data.text || message.snippet}
            </Text>
          )}
        </div>
        {aiReplies ? (
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) write();
              }}
              placeholder="Optional: how to reply (e.g. accept, suggest Thursday)"
            />
            {ai.isRunning ? (
              <Button onClick={ai.stop}>Stop</Button>
            ) : (
              <Button onClick={write} disabled={!body.data}>
                Write with AI
              </Button>
            )}
          </div>
        ) : null}
        {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
        <Textarea
          className="min-h-40 max-h-72"
          value={ai.isRunning ? ai.output : draft}
          readOnly={ai.isRunning}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Your reply"
          placeholder="Write your reply…"
        />
      </div>
    </Dialog>
  );
}
