import { useEffect, useRef, useState } from "react";
import { Button, Callout, Status, Text } from "@glaze/core/components";
import { Sparkles } from "lucide-react";
import type { CalendarEventItem, MailItem, SourceId } from "@main/shared-types";

import { extractJSON, useAITask } from "../lib/ai";
import { PRIORITY_SYSTEM, buildPriorityPrompt } from "../lib/ai-prompts";
import { formatTimeOfDay, todayISO } from "../lib/dates";
import { readStored, writeStored } from "../lib/storage";
import { compareByDue, type Todo } from "../lib/todos";
import { InlineHint, ListCard, RowsSkeleton, SectionCard } from "./section-card";
import { SourceDot } from "./source-dot";
import { TodoRow } from "./todo-row";

const STORAGE_KEY = "dashboard:priorities:v1";

interface StoredPriorities {
  generatedAt: string;
  signature?: string;
  items: { key: string; reason: string }[];
}

function isStoredPriorities(value: unknown): value is StoredPriorities {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.generatedAt === "string" && Array.isArray(v.items);
}

export function UpNextCard({
  todos,
  todayEvents,
  sources,
  loading,
  hint,
  canPrioritize,
  messages = [],
  onChoose,
}: {
  todos: Todo[];
  todayEvents: CalendarEventItem[];
  sources: SourceId[];
  loading: boolean;
  hint: string | null;
  canPrioritize: boolean;
  messages?: MailItem[];
  onChoose?: (todo: Todo) => void;
}) {
  const ai = useAITask();
  const keyMap = useRef(new Map<string, string>());
  const [stored, setStored] = useState(() => readStored(STORAGE_KEY, isStoredPriorities));
  const [parseFailed, setParseFailed] = useState(false);
  const inputSignature = JSON.stringify([
    todayISO(),
    todos.map((todo) => [
      todo.key,
      todo.completed,
      todo.dueDate,
      todo.dueTime,
      todo.title,
      todo.notes,
      todo.listTitle,
    ]),
    todayEvents.map((event) => [event.id, event.start, event.end, event.title, event.location]),
    messages.map((message) => [
      message.id,
      message.subject,
      message.snippet,
      message.from,
      message.date,
    ]),
  ]);
  const signature = String(
    [...inputSignature].reduce((hash, char) => (Math.imul(31, hash) + char.charCodeAt(0)) | 0, 0),
  );
  const runSignature = useRef(signature);

  useEffect(() => {
    if (!ai.isDone) return;
    const value = extractJSON(ai.output);
    const raw =
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: unknown[] }).items
        : [];
    const items = raw.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { key, reason } = entry as Record<string, unknown>;
      const todoKey = typeof key === "string" ? keyMap.current.get(key) : undefined;
      return todoKey ? [{ key: todoKey, reason: typeof reason === "string" ? reason : "" }] : [];
    });
    if (!items.length) {
      setParseFailed(true);
      return;
    }
    const next = { generatedAt: new Date().toISOString(), items, signature: runSignature.current };
    writeStored(STORAGE_KEY, next);
    setStored(next);
    setParseFailed(false);
  }, [ai.isDone, ai.output]);

  const byKey = new Map(todos.map((todo) => [todo.key, todo]));
  const ranked =
    canPrioritize && stored?.signature === signature
      ? (stored?.items.flatMap(({ key, reason }) => {
          const todo = byKey.get(key);
          return todo && !todo.completed ? [{ todo, reason }] : [];
        }) ?? [])
      : [];
  const openTodos = todos.filter((todo) => !todo.completed);
  const showRanked = ranked.some(({ todo }) => !todo.completed);
  const fallback = [...openTodos].sort(compareByDue).slice(0, 6);

  function prioritize() {
    runSignature.current = signature;
    const candidates = [...openTodos]
      .sort(compareByDue)
      .slice(0, 60)
      .map((todo, index) => ({ key: `i${index + 1}`, todo }));
    keyMap.current = new Map(candidates.map(({ key, todo }) => [key, todo.key]));
    setParseFailed(false);
    void ai.run({
      system: PRIORITY_SYSTEM,
      prompt: buildPriorityPrompt(candidates, todayEvents, messages),
      maxOutputTokens: 700,
    });
  }

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          Priorities
          <span className="flex items-center gap-1">
            {sources.map((source) => (
              <SourceDot key={source} source={source} />
            ))}
          </span>
        </span>
      }
      accessory={
        canPrioritize ? (
          <>
            {ai.isRunning ? (
              <Status variant="loading">Ranking…</Status>
            ) : showRanked && stored ? (
              <Text variant="small" color="tertiary">
                Suggested {formatTimeOfDay(stored.generatedAt)}
              </Text>
            ) : null}
            {ai.isRunning ? (
              <Button size="small" onClick={ai.stop}>
                Stop
              </Button>
            ) : (
              <Button size="small" onClick={prioritize} disabled={!openTodos.length}>
                <Sparkles />
                {showRanked ? "Re-rank" : "Prioritize"}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
      {parseFailed ? <Callout color="yellow">Couldn't read the ranking. Try again.</Callout> : null}
      {stored && stored.signature !== signature ? (
        <Text variant="small" color="secondary">
          Your sources changed. Generate fresh suggestions.
        </Text>
      ) : null}
      {loading ? (
        <RowsSkeleton rows={4} />
      ) : showRanked ? (
        <ListCard>
          {ranked.map(({ todo, reason }) => (
            <div key={todo.key}>
              <TodoRow todo={todo} showSource detail={reason || todo.listTitle} />
              {onChoose ? (
                <Button size="small" variant="transparent" onClick={() => onChoose(todo)}>
                  Details and focus
                </Button>
              ) : null}
            </div>
          ))}
        </ListCard>
      ) : fallback.length ? (
        <ListCard>
          {fallback.map((todo) => (
            <div key={todo.key}>
              <TodoRow todo={todo} showSource />
              {onChoose ? (
                <Button size="small" variant="transparent" onClick={() => onChoose(todo)}>
                  Details and focus
                </Button>
              ) : null}
            </div>
          ))}
        </ListCard>
      ) : (
        <InlineHint>{hint ?? "Nothing open. Nice work."}</InlineHint>
      )}
    </SectionCard>
  );
}
