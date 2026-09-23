import { useState, type ChangeEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AIChat, Button } from "@renderer/ui";
import type { AIProvider } from "@main/shared-types";

import { ASSISTANT_SUGGESTIONS } from "../lib/assistant";
import { PROVIDER_LABEL } from "../lib/settings";
import { ProviderMark } from "./provider-logo";

/** Today's composer: sends the question to the Assistant, which runs it with full context. */
export function AskAssistantCard({ provider }: { provider: AIProvider }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);

  function ask(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    setInput("");
    void navigate({ to: "/assistant", search: { prompt } });
  }

  return (
    <div
      className="flex flex-col gap-2"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <AIChat.Composer.Root
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <AIChat.Composer.Surface>
          <AIChat.Composer.Row>
            {/* Composer rows bottom-align children; stretch this slot so the mark centers on the text line. */}
            <span className="flex shrink-0 items-center self-stretch pl-1">
              <ProviderMark provider={provider} className="size-4" />
            </span>
            <AIChat.Composer.Input
              value={input}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
              placeholder={`Ask ${PROVIDER_LABEL[provider]} about your day…`}
              aria-label={`Ask ${PROVIDER_LABEL[provider]}`}
            />
            <AIChat.Composer.Actions>
              <AIChat.Composer.Submit action="send" disabled={!input.trim()} />
            </AIChat.Composer.Actions>
          </AIChat.Composer.Row>
        </AIChat.Composer.Surface>
      </AIChat.Composer.Root>
      {focused ? (
        <div className="flex flex-wrap gap-2 px-1">
          {ASSISTANT_SUGGESTIONS.map((suggestion) => (
            <Button key={suggestion} size="small" onClick={() => ask(suggestion)}>
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
