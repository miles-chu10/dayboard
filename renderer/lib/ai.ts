import type { RequestUsage } from "../../shared/ai-usage";
import { useEffect, useRef, useState } from "react";
import type { AIStreamChunk } from "@main/shared-types";

import { errorMessage } from "./ipc";

/** User-facing text for an `AssistantResult`'s `blocked` code (see `runAssistant`). */
export const BLOCKED_MESSAGE: Record<string, string> = {
  "not-configured": "Set up AI in Settings to use this feature.",
};

interface RunOptions {
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

interface CliState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

/** One streaming AI request using the provider chosen in Settings, run through the backend. */
export function useAITask() {
  const [output, setOutput] = useState("");
  const [usage, setUsage] = useState<RequestUsage | null>(null);
  const [cli, setCli] = useState<CliState>({ status: "idle", error: null });
  const streamRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (streamRef.current) window.dayboard.ipc.cancelStream(streamRef.current);
    },
    [],
  );

  function stop() {
    if (streamRef.current) {
      window.dayboard.ipc.cancelStream(streamRef.current);
      streamRef.current = null;
      setCli({ status: "idle", error: null });
    }
  }

  async function run(options: RunOptions) {
    stop();
    setOutput("");
    setUsage(null);
    const id = crypto.randomUUID();
    streamRef.current = id;
    setCli({ status: "loading", error: null });
    try {
      await window.dayboard.ipc.stream<AIStreamChunk, { text: string; usage?: RequestUsage }>(
        "ai:run",
        { system: options.system, prompt: options.prompt },
        (chunk) => {
          if (streamRef.current === id && chunk.type === "usage") setUsage(chunk.usage);
          if (streamRef.current === id && chunk.type === "delta")
            setOutput((current) => current + chunk.text);
        },
        { cancellationId: id },
      );
      if (streamRef.current !== id) return;
      streamRef.current = null;
      setCli({ status: "ready", error: null });
    } catch (error) {
      if (streamRef.current !== id) return;
      streamRef.current = null;
      setCli({ status: "error", error: errorMessage(error) });
    }
  }

  function clear() {
    stop();
    setOutput("");
    setUsage(null);
    setCli({ status: "idle", error: null });
  }

  return {
    output,
    usage,
    run,
    stop,
    clear,
    isRunning: cli.status === "loading",
    isDone: cli.status === "ready" && output.length > 0,
    message: cli.error,
  };
}

/** Pull the first JSON object/array out of model output, tolerating code fences and stray prose. */
export function extractJSON(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.search(/[[{]/);
  if (start < 0) return undefined;
  const close = cleaned[start] === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
