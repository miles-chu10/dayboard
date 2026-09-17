import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Callout, Dialog, Input, Status, Text, Textarea, toast } from "@glaze/core/components";
import type { MailItem } from "@main/shared-types";

import { useAITask } from "../lib/ai";
import { REPLY_SYSTEM, buildReplyPrompt } from "../lib/ai-prompts";
import { errorMessage, invoke } from "../lib/ipc";
import { useAccounts } from "../lib/queries";

/** Render with `key={message?.id}` so each message starts with fresh state. */
export function ReplyDialog({
  message,
  onOpenChange,
}: {
  message: MailItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const accounts = useAccounts();
  const ai = useAITask();
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState("");

  const body = useQuery({
    queryKey: ["mail-body", message?.id],
    queryFn: () => invoke<{ text: string }>("mail:getBody", { id: message!.id }),
    enabled: message !== null,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (ai.isDone) setDraft(ai.output.trim());
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
      confirmLabel="Save Draft"
      confirmDisabled={!draft.trim() || ai.isRunning}
      onConfirm={save}
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
        {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
        <Textarea
          className="min-h-40 max-h-72"
          value={ai.isRunning ? ai.output : draft}
          readOnly={ai.isRunning}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write your reply…"
        />
      </div>
    </Dialog>
  );
}
