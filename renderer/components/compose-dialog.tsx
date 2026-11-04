import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, Field, FieldGroup, Input, Text, Textarea, toast } from "@renderer/ui";
import type { MailSendRequest, MailSendResult, MailSendTicket } from "@main/shared-types";

import { errorMessage, invoke } from "../lib/ipc";

export interface ComposeDraft {
  /** Set for a reply: the message it answers. */
  replyToId?: string;
  /** Shown instead of the To field for a reply, e.g. "Reply to Sam Patel". */
  heading?: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
}

type SendMail = (request: MailSendRequest, restore: () => void) => Promise<void>;

const ComposeContext = createContext<{
  openCompose: (draft?: Partial<ComposeDraft>) => void;
  sendMail: SendMail;
}>({ openCompose: () => {}, sendMail: async () => {} });

export function useCompose() {
  return useContext(ComposeContext);
}

const EMPTY: ComposeDraft = { to: "", cc: "", subject: "", body: "" };

/**
 * New emails and the shared send path. A held send shows a toast with Undo; undoing (or a failed
 * send) reopens the message here so nothing typed is lost.
 */
export function ComposeProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [generation, setGeneration] = useState(0);
  const tickets = useRef(new Map<string, { toastId: string | number; restore: () => void }>());

  function openCompose(next?: Partial<ComposeDraft>) {
    setDraft({ ...EMPTY, ...next });
    setGeneration((value) => value + 1);
  }

  useEffect(
    () =>
      window.dayboard.ipc.onNotification("mail:sendResult", (value) => {
        const result = value as MailSendResult;
        const ticket = tickets.current.get(result.id);
        if (!ticket) return;
        tickets.current.delete(result.id);
        if (result.ok) toast.success("Sent", { id: ticket.toastId, duration: 2500 });
        else
          toast.error(`Couldn't send: ${result.error}`, {
            id: ticket.toastId,
            action: { label: "Edit", onClick: ticket.restore },
          });
      }),
    [],
  );

  const sendMail: SendMail = async (request, restore) => {
    const ticket = await invoke<MailSendTicket>("mail:send", request);
    if (!ticket.held) {
      toast.success("Sent");
      return;
    }
    const toastId = toast("Sending…", {
      duration: Math.max(1000, ticket.sendAt - Date.now()) + 4000,
      action: {
        label: "Undo",
        onClick: () => {
          void invoke<{ cancelled: boolean }>("mail:cancelSend", {
            id: ticket.id,
          }).then(
            ({ cancelled }) => {
              if (!cancelled) {
                toast("It was already sent.");
                return;
              }
              tickets.current.delete(ticket.id);
              toast("Send cancelled", { id: toastId, duration: 2500 });
              restore();
            },
            (error: unknown) => toast.error(`Couldn't undo: ${errorMessage(error)}`),
          );
        },
      },
    });
    tickets.current.set(ticket.id, { toastId, restore });
  };

  return (
    <ComposeContext.Provider value={{ openCompose, sendMail }}>
      {children}
      {draft ? (
        <ComposeDialog
          key={generation}
          initial={draft}
          onClose={() => setDraft(null)}
          sendMail={sendMail}
          reopen={openCompose}
        />
      ) : null}
    </ComposeContext.Provider>
  );
}

function ComposeDialog({
  initial,
  onClose,
  sendMail,
  reopen,
}: {
  initial: ComposeDraft;
  onClose: () => void;
  sendMail: SendMail;
  reopen: (draft: ComposeDraft) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const reply = Boolean(value.replyToId);
  const set = (key: keyof ComposeDraft) => (text: string) =>
    setValue((current) => ({ ...current, [key]: text }));

  async function send() {
    setError(null);
    const request: MailSendRequest = value.replyToId
      ? {
          kind: "reply",
          id: value.replyToId,
          body: value.body,
          cc: value.cc || undefined,
        }
      : {
          kind: "new",
          to: value.to,
          subject: value.subject,
          body: value.body,
          cc: value.cc || undefined,
        };
    try {
      const snapshot = value;
      await sendMail(request, () => reopen(snapshot));
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="large"
      title={value.heading ?? "New Email"}
      description={reply ? value.subject : undefined}
      confirmLabel="Send"
      confirmDisabled={!value.body.trim() || (!reply && !value.to.trim())}
      onConfirm={send}
    >
      <div
        className="flex flex-col gap-3"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      >
        <FieldGroup>
          {reply ? null : (
            <Field label="To">
              <Input
                aria-label="To"
                autoFocus
                value={value.to}
                onChange={(event) => set("to")(event.target.value)}
                placeholder="name@example.com, another@example.com"
              />
            </Field>
          )}
          <Field label="Cc">
            <Input
              aria-label="Cc"
              value={value.cc}
              onChange={(event) => set("cc")(event.target.value)}
              placeholder="Optional"
            />
          </Field>
          {reply ? null : (
            <Field label="Subject">
              <Input
                aria-label="Subject"
                value={value.subject}
                onChange={(event) => set("subject")(event.target.value)}
              />
            </Field>
          )}
        </FieldGroup>
        <Textarea
          aria-label="Message"
          autoFocus={reply}
          className="min-h-48 max-h-96"
          value={value.body}
          onChange={(event) => set("body")(event.target.value)}
          placeholder="Write your message…"
        />
        {error ? (
          <Text variant="small" color="red" role="alert">
            {error}
          </Text>
        ) : (
          <Text variant="small" color="tertiary">
            ⌘↩ sends. You can undo for a few seconds after sending.
          </Text>
        )}
      </div>
    </Dialog>
  );
}
