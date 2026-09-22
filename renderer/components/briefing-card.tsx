import { useEffect, useRef, useState } from "react";
import {
  Button,
  Callout,
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleChevron,
  Markdown,
  Status,
  Text,
} from "@glaze/core/components";

import { useAITask } from "../lib/ai";
import { BRIEFING_SYSTEM } from "../lib/ai-prompts";
import { formatTimeOfDay, shortDate, todayISO } from "../lib/dates";
import { readStored, writeStored } from "../lib/storage";

const STORAGE_KEY = "dashboard:briefing:v1";

interface StoredBriefing {
  date: string;
  generatedAt: string;
  markdown: string;
}

function isStoredBriefing(value: unknown): value is StoredBriefing {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.date === "string" &&
    typeof v.generatedAt === "string" &&
    typeof v.markdown === "string"
  );
}

export function BriefingCard({
  ready,
  autoGenerate,
  buildPrompt,
  summary,
}: {
  ready: boolean;
  /** Generate once per day, the first time the dashboard opens with data loaded. */
  autoGenerate: boolean;
  buildPrompt: () => string;
  summary?: string;
}) {
  const ai = useAITask();
  const [stored, setStored] = useState(() => readStored(STORAGE_KEY, isStoredBriefing));
  const autoStarted = useRef(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!ai.isDone) return;
    const next = { date: todayISO(), generatedAt: new Date().toISOString(), markdown: ai.output };
    writeStored(STORAGE_KEY, next);
    setStored(next);
  }, [ai.isDone, ai.output]);

  function generate() {
    void ai.run({ system: BRIEFING_SYSTEM, prompt: buildPrompt(), maxOutputTokens: 600 });
  }

  useEffect(() => {
    if (!autoGenerate || !ready || autoStarted.current || stored?.date === todayISO()) return;
    autoStarted.current = true;
    generate();
  }, [autoGenerate, ready, stored]);

  const text = ai.isRunning || ai.isDone ? ai.output : (stored?.markdown ?? "");
  const stamp =
    stored && !ai.isRunning
      ? stored.date === todayISO()
        ? `Updated ${formatTimeOfDay(stored.generatedAt)}`
        : `From ${shortDate(stored.date)}`
      : null;

  return (
    <CollapsibleRoot open={expanded} onOpenChange={setExpanded}>
      <div className="flex items-center gap-2 min-w-0">
        <CollapsibleTrigger className="flex-1 min-w-0" aria-label="Expand daily briefing">
          <CollapsibleChevron />
          <Text truncate>{summary ?? "Daily briefing"}</Text>
        </CollapsibleTrigger>
        <div className="flex items-center gap-2 shrink-0">
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
            <Button
              size="small"
              onClick={() => {
                setExpanded(true);
                generate();
              }}
              disabled={!ready}
            >
              {stored ? "Update brief" : "Brief me"}
            </Button>
          )}
        </div>
      </div>
      <CollapsibleContent>
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
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}
