import { useEffect, useRef, useState } from "react";
import { useGlazeAI } from "@glaze/core/hooks";

const BLOCKED_MESSAGE: Record<string, string> = {
  "needs-consent": "AI access wasn't allowed. Try again when you're ready.",
  "signed-out": "Sign in to Glaze to use AI features.",
  "needs-subscription": "This needs an upgraded Glaze plan. Try again to see options.",
  "insufficient-credits": "You're out of Glaze AI credits for now.",
  "daily-limit-reached": "You've reached today's AI limit for this app.",
  "host-unavailable": "Glaze couldn't be reached. Try again.",
  disabled: "AI is currently unavailable for this account.",
};

interface RunOptions {
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

/** One streaming AI request with cancellation, blocked-state messaging, and auto-resume support. */
export function useAITask() {
  const { streamText, state, error, enableInHost, reset } = useGlazeAI();
  const [output, setOutput] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(options: RunOptions) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOutput("");
    try {
      await streamText({
        model: "fast",
        ...options,
        abortSignal: controller.signal,
        onTextDelta: (delta) => setOutput((current) => current + delta),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && "state" in err && err.state === "host-unavailable") {
        await enableInHost();
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clear() {
    abortRef.current?.abort();
    setOutput("");
    reset();
  }

  const isAbort = error?.name === "AbortError";
  const message =
    BLOCKED_MESSAGE[state] ?? (error && !isAbort && state !== "loading" ? "The AI request failed. Try again." : null);

  return {
    output,
    run,
    stop,
    clear,
    isRunning: state === "loading",
    isDone: state === "ready" && output.length > 0,
    message,
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
