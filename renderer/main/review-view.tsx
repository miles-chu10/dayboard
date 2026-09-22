import { useEffect, useState } from "react";
import { Button, Callout, Markdown, ScrollArea, Status, Text } from "@glaze/core/components";
import { RotateCw } from "lucide-react";
import type { SourceId } from "@main/shared-types";

import { InlineHint, ListCard, RowsSkeleton, SectionCard } from "../components/section-card";
import { SourceDot } from "../components/source-dot";
import { sourceStatusShort } from "../components/source-gate";
import { TodoRow } from "../components/todo-row";
import { HistoryNav } from "../components/history-nav";
import { useAITask } from "../lib/ai";
import { REVIEW_SYSTEM, buildWeeklyReviewPrompt } from "../lib/ai-prompts";
import { formatTimeOfDay, shortDate, todayISO } from "../lib/dates";
import { useCalendar, useReminders, useReview, useTasks } from "../lib/queries";
import { featureOn, useSettings } from "../lib/settings";
import { readStored, writeStored } from "../lib/storage";
import { buildTodos, compareByDue } from "../lib/todos";

const STORAGE_KEY = "dashboard:review:v1";

interface StoredReview {
  generatedAt: string;
  markdown: string;
}

function isStoredReview(value: unknown): value is StoredReview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.generatedAt === "string" && typeof v.markdown === "string";
}

function StatTile({
  source,
  label,
  value,
  caption,
}: {
  source?: SourceId;
  label: string;
  value: number | null;
  caption: string;
}) {
  return (
    <div className="rounded-xl bg-well px-3.5 py-3 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {source ? <SourceDot source={source} className="size-2.5" /> : null}
        <Text variant="small-strong" color="secondary" truncate>
          {label}
        </Text>
      </div>
      <Text variant="heading1" as="p" className="tabular-nums">
        {value === null ? "–" : value}
      </Text>
      <Text variant="small" color="tertiary" truncate>
        {caption}
      </Text>
    </div>
  );
}

export function ReviewView() {
  const settings = useSettings().data;
  const aiOn = featureOn(settings, "weeklyReview");
  const review = useReview();
  const tasks = useTasks();
  const reminders = useReminders();
  const calendar = useCalendar();
  const ai = useAITask();
  const [stored, setStored] = useState(() => readStored(STORAGE_KEY, isStoredReview));

  useEffect(() => {
    if (!ai.isDone) return;
    const next = { generatedAt: new Date().toISOString(), markdown: ai.output };
    writeStored(STORAGE_KEY, next);
    setStored(next);
  }, [ai.isDone, ai.output]);

  const today = todayISO();
  const data = review.data;
  const completed = data
    ? buildTodos(data.tasks, data.reminders).sort((a, b) =>
        (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
      )
    : [];
  const pastEvents = data?.events.state === "ok" ? data.events.items : null;
  const overdue = buildTodos(tasks.data, reminders.data)
    .filter((todo) => !todo.completed && todo.dueDate && todo.dueDate < today)
    .sort(compareByDue);
  const upcoming = calendar.data?.state === "ok" ? calendar.data.items : null;

  const countDone = (source: "tasks" | "reminders") =>
    data?.[source].state === "ok"
      ? completed.filter((todo) => todo.source === source).length
      : null;

  function generate() {
    if (!data) return;
    void ai.run({
      system: REVIEW_SYSTEM,
      prompt: buildWeeklyReviewPrompt({
        since: data.since,
        completed,
        pastEvents,
        overdue,
        upcoming,
      }),
      maxOutputTokens: 900,
    });
  }

  const text = ai.isRunning || ai.isDone ? ai.output : (stored?.markdown ?? "");

  return (
    <ScrollArea
      className="h-full"
      leading={<HistoryNav />}
      title="Weekly Review"
      subtitle={
        data ? `${shortDate(data.since.slice(0, 10))} – ${shortDate(today)}` : "Past 7 days"
      }
      actions={
        <>
          <Button
            iconOnly
            aria-label="Refresh"
            title="Refresh"
            onClick={() => void review.refetch()}
            disabled={review.isFetching}
          >
            <RotateCw />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--density-section-gap)] px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
        {review.isError ? (
          <Callout color="red">Couldn't load the past week. Try refreshing.</Callout>
        ) : null}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            source="tasks"
            label="Tasks Done"
            value={countDone("tasks")}
            caption={sourceStatusShort(data?.tasks) ?? "Past 7 days"}
          />
          <StatTile
            source="reminders"
            label="Reminders Done"
            value={countDone("reminders")}
            caption={sourceStatusShort(data?.reminders) ?? "Past 7 days"}
          />
          <StatTile
            source="calendar"
            label="Meetings"
            value={pastEvents ? pastEvents.filter((event) => !event.allDay).length : null}
            caption={sourceStatusShort(data?.events) ?? "Timed events"}
          />
          <StatTile label="Overdue" value={overdue.length} caption="Still open" />
        </div>

        {aiOn ? (
          <SectionCard
            title="Your Week in Review"
            accessory={
              <>
                {stored && !ai.isRunning ? (
                  <Text variant="small" color="tertiary">
                    {`${shortDate(stored.generatedAt.slice(0, 10))}, ${formatTimeOfDay(stored.generatedAt)}`}
                  </Text>
                ) : null}
                {ai.isRunning ? (
                  <Button size="small" onClick={ai.stop}>
                    Stop
                  </Button>
                ) : (
                  <Button size="small" variant="accent" onClick={generate} disabled={!data}>
                    {stored ? "Write New Review" : "Write Review"}
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
                <Status variant="loading">Reviewing your week…</Status>
              ) : (
                <Text color="tertiary" as="p">
                  Get wins, what slipped, where your time went, and three things to focus on next
                  week.
                </Text>
              )}
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Completed"
          accessory={
            <Text variant="small" color="tertiary" className="tabular-nums">
              {completed.length}
            </Text>
          }
        >
          {review.isPending ? (
            <RowsSkeleton rows={4} />
          ) : completed.length ? (
            <ListCard>
              {completed.slice(0, 50).map((todo) => (
                <div
                  key={todo.key}
                  className="flex items-center gap-3 px-3 py-[var(--density-row-py)] min-h-[var(--density-list-row)] min-w-0"
                >
                  <SourceDot source={todo.source} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <Text truncate>{todo.title}</Text>
                    <Text variant="small" color="tertiary" truncate>
                      {todo.listTitle}
                    </Text>
                  </div>
                  {todo.completedAt ? (
                    <Text variant="small" color="tertiary" className="shrink-0 tabular-nums">
                      {shortDate(todo.completedAt.slice(0, 10))}
                    </Text>
                  ) : null}
                </div>
              ))}
            </ListCard>
          ) : (
            <InlineHint>Nothing completed in the past 7 days.</InlineHint>
          )}
        </SectionCard>

        <SectionCard
          title="Slipped"
          accessory={
            <Text variant="small" color="tertiary" className="tabular-nums">
              {overdue.length}
            </Text>
          }
        >
          {tasks.isPending || reminders.isPending ? (
            <RowsSkeleton rows={3} />
          ) : overdue.length ? (
            <ListCard>
              {overdue.map((todo) => (
                <TodoRow key={todo.key} todo={todo} showSource />
              ))}
            </ListCard>
          ) : (
            <InlineHint>Nothing overdue. Nice work.</InlineHint>
          )}
        </SectionCard>
      </div>
    </ScrollArea>
  );
}
