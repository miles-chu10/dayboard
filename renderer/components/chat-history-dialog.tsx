import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Text,
} from "@glaze/core/components";
import { MessageSquare } from "lucide-react";
import type { AssistantChat } from "../../shared/assistant-history";
import { ProviderMark } from "./provider-logo";

export function ChatHistoryDialog({
  open,
  onOpenChange,
  chats,
  activeId,
  busy,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chats: AssistantChat[];
  activeId: string;
  busy: boolean;
  onSelect: (id: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const visible = chats.filter(
    (chat) =>
      !needle ||
      `${chat.title}\n${chat.messages.map((message) => message.content).join("\n")}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle variant="heading2">Chat history</DialogTitle>
          <DialogDescription>
            Reopen a conversation to continue where you left off.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Input
            aria-label="Search chat history"
            placeholder="Search conversations…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div aria-label="Saved conversations">
            {visible.length ? (
              visible.map((chat) => {
                const provider = [...chat.messages]
                  .reverse()
                  .find((message) => message.role === "assistant")?.provider;
                const date = new Date(chat.updatedAt);
                return (
                  <button
                    type="button"
                    key={chat.id}
                    disabled={busy}
                    aria-current={chat.id === activeId ? "true" : undefined}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 aria-[current=true]:bg-control-subtle"
                    onClick={() => void onSelect(chat.id)}
                  >
                    {provider ? (
                      <ProviderMark provider={provider} className="size-5 shrink-0" />
                    ) : (
                      <MessageSquare className="size-5 shrink-0 text-secondary" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Text variant="strong" truncate>
                        {chat.title}
                      </Text>
                      <Text variant="small" color="secondary">
                        {chat.messages.length} messages
                        {chat.id === activeId ? " · Current chat" : ""}
                      </Text>
                    </span>
                    <Text variant="small" color="tertiary" className="shrink-0">
                      {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </Text>
                  </button>
                );
              })
            ) : (
              <div className="p-6 text-center">
                <Text color="secondary">
                  {needle
                    ? "No conversations match your search."
                    : "Your saved conversations will appear here."}
                </Text>
              </div>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
