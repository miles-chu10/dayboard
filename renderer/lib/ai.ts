import { glazeRequestUsage, type RequestUsage } from "../../shared/ai-usage";
import { useEffect, useRef, useState } from "react";
import { useGlazeAI } from "@glaze/core/hooks";
import type { AIStreamChunk } from "@main/shared-types";

import { errorMessage } from "./ipc";
import { isRendererDemoMode } from "./demo";
import { useSettings } from "./settings";

import { BLOCKED_MESSAGE } from "../../shared/ai-blocked";

export { BLOCKED_MESSAGE };

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
  const demo = isRendererDemoMode();
  const provider = useSettings().data?.ai.provider ?? "glaze";
  const glazeAI = useGlazeAI();
  const [output, setOutput] = useState("");
  const [usage, setUsage] = useState<RequestUsage | null>(null);
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
    const startedAt = Date.now();
    try {
      const result = await glazeAI.streamText({
        model: "fast",
        ...options,
        abortSignal: controller.signal,
        onTextDelta: (delta) => setOutput((current) => current + delta),
      });
      if (!controller.signal.aborted)
        setUsage(glazeRequestUsage(result.usage, Date.now() - startedAt));
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
      await window.glazeAPI.glaze.ipc.stream<AIStreamChunk, { text: string; usage?: RequestUsage }>(
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
    setUsage(null);
    setRunProvider(provider);
    if (demo || provider !== "glaze") await runCli(options);
    else await runGlaze(options);
  }

  function clear() {
    stop();
    setOutput("");
    setUsage(null);
    if (!demo) glazeAI.reset();
    setCli({ status: "idle", error: null });
  }

  const usingGlaze = !demo && runProvider === "glaze";
  const glazeAborted = glazeAI.error?.name === "AbortError";
  const message = usingGlaze
    ? (BLOCKED_MESSAGE[glazeAI.state] ??
      (glazeAI.error && !glazeAborted && glazeAI.state !== "loading"
        ? "The AI request failed. Try again."
        : null))
    : cli.error;

  return {
    output,
    usage,
    run,
    stop,
    clear,
    isRunning: usingGlaze ? glazeAI.state === "loading" : cli.status === "loading",
    isDone: (usingGlaze ? glazeAI.state === "ready" : cli.status === "ready") && output.length > 0,
    message,
  };
}

/** Pull the first JSON object/array out of model output, tolerating code fences and stray prose. */
export { extractJSON } from "../../shared/json-extract";
