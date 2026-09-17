import { useEffect, useRef, useState } from "react";
import { useGlazeAI } from "@glaze/core/hooks";
import type { AIStreamChunk } from "@main/shared-types";

import { errorMessage } from "./ipc";
import { useSettings } from "./settings";

export const BLOCKED_MESSAGE: Record<string, string> = {
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

interface CliState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

/**
 * One streaming AI request using the provider chosen in Settings. Glaze AI runs through
 * useGlazeAI (consent, credits, auto-resume); Claude and ChatGPT run their CLIs in the backend.
 */
export function useAITask() {
  const provider = useSettings().data?.ai.provider ?? "glaze";
  const glazeAI = useGlazeAI();
  const [output, setOutput] = useState("");
  const [runProvider, setRunProvider] = useState(provider);
  const [cli, setCli] = useState<CliState>({ status: "idle", error: null });
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (streamRef.current) window.glazeAPI.glaze.ipc.cancelStream(streamRef.current);
    },
    [],
  );

  async function runGlaze(options: RunOptions) {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await glazeAI.streamText({
        model: "fast",
        ...options,
        abortSignal: controller.signal,
        onTextDelta: (delta) => setOutput((current) => current + delta),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && "state" in err && err.state === "host-unavailable") {
        await glazeAI.enableInHost();
      }
    }
  }

  async function runCli(options: RunOptions) {
    const id = crypto.randomUUID();
    streamRef.current = id;
    setCli({ status: "loading", error: null });
    try {
      await window.glazeAPI.glaze.ipc.stream<AIStreamChunk, { text: string }>(
        "ai:run",
        { system: options.system, prompt: options.prompt },
        (chunk) => {
          if (streamRef.current === id && chunk.type === "delta") setOutput((current) => current + chunk.text);
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

  function stop() {
    abortRef.current?.abort();
    if (streamRef.current) {
      window.glazeAPI.glaze.ipc.cancelStream(streamRef.current);
      streamRef.current = null;
      setCli({ status: "idle", error: null });
    }
  }

  async function run(options: RunOptions) {
    stop();
    setOutput("");
    setRunProvider(provider);
    if (provider === "glaze") await runGlaze(options);
    else await runCli(options);
  }

  function clear() {
    stop();
    setOutput("");
    glazeAI.reset();
    setCli({ status: "idle", error: null });
  }

  const usingGlaze = runProvider === "glaze";
  const glazeAborted = glazeAI.error?.name === "AbortError";
  const message = usingGlaze
    ? (BLOCKED_MESSAGE[glazeAI.state] ??
      (glazeAI.error && !glazeAborted && glazeAI.state !== "loading" ? "The AI request failed. Try again." : null))
    : cli.error;

  return {
    output,
    run,
    stop,
    clear,
    isRunning: usingGlaze ? glazeAI.state === "loading" : cli.status === "loading",
    isDone: (usingGlaze ? glazeAI.state === "ready" : cli.status === "ready") && output.length > 0,
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
