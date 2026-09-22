import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, FieldSet, Input, toast } from "@glaze/core/components";
import type { OpenAIKeyStatus } from "@main/shared-types";

import { errorMessage, invoke } from "../lib/ipc";

/** OpenAI API key used only for Assistant dictation. The key is write-only from here. */
export function OpenAIKeySettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const status = useQuery({
    queryKey: ["openai-key"],
    queryFn: () => invoke<OpenAIKeyStatus>("openai:keyStatus"),
  });
  const save = useMutation({
    mutationFn: (key: string) => invoke<OpenAIKeyStatus>("openai:saveKey", { key }),
    onSuccess: (next) => {
      queryClient.setQueryData(["openai-key"], next);
      setDraft("");
      toast.success("OpenAI API key saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const clear = useMutation({
    mutationFn: () => invoke<OpenAIKeyStatus>("openai:clearKey"),
    onSuccess: (next) => queryClient.setQueryData(["openai-key"], next),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <FieldSet
      title="Dictation"
      description="Dictation in the Assistant records from your microphone and transcribes with OpenAI. Your key is stored encrypted on this Mac and only used for transcription."
    >
      <Field
        label="OpenAI API key"
        description={
          status.data?.configured
            ? `Saved key ending in ${status.data.hint}.`
            : "Create one at platform.openai.com → API keys."
        }
        orientation="vertical"
      >
        <div className="flex w-full items-center gap-2">
          <Input
            type="password"
            aria-label="OpenAI API key"
            placeholder={status.data?.configured ? "Enter a new key to replace it" : "sk-…"}
            value={draft}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            className="flex-1"
          />
          <Button
            size="small"
            disabled={!draft.trim() || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            Save
          </Button>
          {status.data?.configured ? (
            <Button
              size="small"
              variant="transparent"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </Field>
    </FieldSet>
  );
}
