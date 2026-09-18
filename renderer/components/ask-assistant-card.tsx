import { useState, type ChangeEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AIChat, Button } from "@glaze/core/components";
import type { AIProvider } from "@main/shared-types";

import { ASSISTANT_SUGGESTIONS } from "../lib/assistant";
import { PROVIDER_LABEL } from "../lib/settings";
import { ProviderMark } from "./provider-logo";
import { SectionCard } from "./section-card";

/** Today's composer: sends the question to the Assistant, which runs it with full context. */
export function AskAssistantCard({ provider }: { provider: AIProvider }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");

  function ask(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    setInput("");
    void navigate({ to: "/assistant", search: { prompt } });
  }

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2 min-w-0">
          <ProviderMark provider={provider} className="size-4" />
          <span className="truncate">Ask {PROVIDER_LABEL[provider]}</span>
        </span>
      }
      accessory={
        <Button
          size="small"
          variant="transparent"
          onClick={() => void navigate({ to: "/assistant" })}
        >
          Assistant
        </Button>
      }
    >
      <AIChat.Composer.Root
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <AIChat.Composer.Surface>
          <AIChat.Composer.Row>
            <AIChat.Composer.Input
              value={input}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
              placeholder="Ask about your tasks, mail, or schedule…"
              aria-label={`Ask ${PROVIDER_LABEL[provider]}`}
            />
            <AIChat.Composer.Actions>
              <AIChat.Composer.Submit action="send" disabled={!input.trim()} />
            </AIChat.Composer.Actions>
          </AIChat.Composer.Row>
        </AIChat.Composer.Surface>
      </AIChat.Composer.Root>
      <div className="flex flex-wrap gap-2 px-1">
        {ASSISTANT_SUGGESTIONS.map((suggestion) => (
          <Button key={suggestion} size="small" onClick={() => ask(suggestion)}>
            {suggestion}
          </Button>
        ))}
      </div>
    </SectionCard>
  );
}
