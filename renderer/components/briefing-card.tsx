import { useEffect, useState } from "react";
import { Button, Callout, Markdown, Status, Text } from "@glaze/core/components";

import { useAITask } from "../lib/ai";
import { BRIEFING_SYSTEM } from "../lib/ai-prompts";
import { formatTimeOfDay, shortDate, todayISO } from "../lib/dates";
import { readStored, writeStored } from "../lib/storage";
import { SectionCard } from "./section-card";

const STORAGE_KEY = "dashboard:briefing:v1";

interface StoredBriefing {
  date: string;
  generatedAt: string;
  markdown: string;
}

function isStoredBriefing(value: unknown): value is StoredBriefing {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.date === "string" && typeof v.generatedAt === "string" && typeof v.markdown === "string";
}

export function BriefingCard({ ready, buildPrompt }: { ready: boolean; buildPrompt: () => string }) {
  const ai = useAITask();
  const [stored, setStored] = useState(() => readStored(STORAGE_KEY, isStoredBriefing));

  useEffect(() => {
    if (!ai.isDone) return;
    const next = { date: todayISO(), generatedAt: new Date().toISOString(), markdown: ai.output };
    writeStored(STORAGE_KEY, next);
    setStored(next);
  }, [ai.isDone, ai.output]);

  const text = ai.isRunning || ai.isDone ? ai.output : (stored?.markdown ?? "");
  const stamp =
    stored && !ai.isRunning
      ? stored.date === todayISO()
        ? `Updated ${formatTimeOfDay(stored.generatedAt)}`
        : `From ${shortDate(stored.date)}`
      : null;

  function generate() {
    void ai.run({ system: BRIEFING_SYSTEM, prompt: buildPrompt(), maxOutputTokens: 600 });
  }

  return (
    <SectionCard
      title="Daily Briefing"
      accessory={
        <>
          {stamp ? (
            <Text variant="small" color="tertiary">
              {stamp}
            </Text>
          ) : null}
          {ai.isRunning ? (
            <Button size="small" onClick={ai.stop}>
              Stop
            </Button>
          ) : (
            <Button size="small" variant="accent" onClick={generate} disabled={!ready}>
              {stored ? "Refresh Briefing" : "Generate Briefing"}
            </Button>
          )}
        </>
      }
    >
      {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
      <div className="rounded-xl bg-well px-4 py-3 min-h-16">
        {text ? (
          <Markdown isStreaming={ai.isRunning}>{text}</Markdown>
        ) : ai.isRunning ? (
          <Status variant="loading">Writing your briefing…</Status>
        ) : (
          <Text color="tertiary" as="p">
            {ready
              ? "Get a quick rundown of today's schedule, what's due, and what needs a reply."
              : "Loading your sources…"}
          </Text>
        )}
      </div>
    </SectionCard>
  );
}
