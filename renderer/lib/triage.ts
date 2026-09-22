import { useEffect, useRef, useState } from "react";
import type { MailItem } from "@main/shared-types";

import { extractJSON, useAITask } from "./ai";
import { TRIAGE_SYSTEM, buildTriagePrompt } from "./ai-prompts";
import { readStored, writeStored } from "./storage";

export type TriageCategory = "needs-reply" | "fyi" | "ignore";

export interface TriageResult {
  category: TriageCategory;
  reason: string;
  task: string;
}

export type TriageMap = Record<string, TriageResult>;

export const TRIAGE_LABEL: Record<
  TriageCategory,
  { label: string; color: "orange" | "blue" | "secondary" }
> = {
  "needs-reply": { label: "Needs Reply", color: "orange" },
  fyi: { label: "FYI", color: "blue" },
  ignore: { label: "Ignorable", color: "secondary" },
};

const STORAGE_KEY = "dashboard:triage:v1";
const MAX_STORED = 300;

function isCategory(value: unknown): value is TriageCategory {
  return value === "needs-reply" || value === "fyi" || value === "ignore";
}

function isTriageMap(value: unknown): value is TriageMap {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (entry) =>
        typeof entry === "object" && entry !== null && isCategory((entry as TriageResult).category),
    )
  );
}

export function readTriageMap(): TriageMap {
  return readStored(STORAGE_KEY, isTriageMap) ?? {};
}

export function useTriage(messages: MailItem[] | undefined) {
  const ai = useAITask();
  const [map, setMap] = useState<TriageMap>(readTriageMap);
  const [parseFailed, setParseFailed] = useState(false);
  const keyMap = useRef(new Map<string, string>());

  useEffect(() => {
    if (!ai.isDone) return;
    const value = extractJSON(ai.output);
    const emails =
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { emails?: unknown }).emails)
        ? (value as { emails: unknown[] }).emails
        : [];
    const results: TriageMap = {};
    for (const entry of emails) {
      if (typeof entry !== "object" || entry === null) continue;
      const { key, category, reason, task } = entry as Record<string, unknown>;
      const id = typeof key === "string" ? keyMap.current.get(key) : undefined;
      if (!id || !isCategory(category)) continue;
      results[id] = {
        category,
        reason: typeof reason === "string" ? reason : "",
        task: typeof task === "string" ? task.trim() : "",
      };
    }
    if (!Object.keys(results).length) {
      setParseFailed(true);
      return;
    }
    setParseFailed(false);
    setMap((previous) => {
      const merged = Object.entries({ ...previous, ...results }).slice(-MAX_STORED);
      const next = Object.fromEntries(merged);
      writeStored(STORAGE_KEY, next);
      return next;
    });
  }, [ai.isDone, ai.output]);

  function run() {
    if (!messages?.length) return;
    const untriaged = messages.filter((message) => !map[message.id]);
    const targets = untriaged.length ? untriaged : messages;
    const candidates = targets.map((message, index) => ({ key: `m${index + 1}`, message }));
    keyMap.current = new Map(candidates.map(({ key, message }) => [key, message.id]));
    setParseFailed(false);
    void ai.run({
      system: TRIAGE_SYSTEM,
      prompt: buildTriagePrompt(candidates),
      maxOutputTokens: Math.min(2000, 60 * candidates.length + 100),
    });
  }

  return {
    map,
    run,
    stop: ai.stop,
    isRunning: ai.isRunning,
    message: ai.message,
    parseFailed,
    hasResults: Boolean(messages?.some((message) => map[message.id])),
  };
}
