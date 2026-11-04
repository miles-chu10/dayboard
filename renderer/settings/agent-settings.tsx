import { useState } from "react";
import { Badge, Button, Field, FieldSet, Input, Status, Switch, Text } from "@renderer/ui";
import type { AgentActivityEntry, MemorySource } from "@main/shared-types";

import { useActivity, useMemories, useMemoryActions, useUsage } from "../lib/agent-data";
import { todayISO } from "../lib/dates";
import { errorMessage } from "../lib/ipc";
import { useSettingsEditor } from "../lib/settings";
import { compactNumber, usageBars, usageByModel } from "../lib/usage";

const SOURCE_LABEL: Record<MemorySource, string> = {
  you: "You",
  agent: "An agent",
  learned: "Learned from your edits",
};

/** Settings → AI → Memory: what DayBoard tells the Assistant and reply drafts about the user. */
export function MemorySettings() {
  const { settings, edit } = useSettingsEditor();
  const memories = useMemories();
  const { add, remove } = useMemoryActions();
  const [text, setText] = useState("");
  if (!settings) return null;

  function save() {
    const value = text.trim();
    if (!value) return;
    add.mutate(value, { onSuccess: () => setText("") });
  }

  return (
    <FieldSet
      title="Memory"
      description="Preferences the Assistant and reply drafts follow. Add your own; DayBoard also learns from how you edit its reply drafts."
    >
      <Field
        label="Use memory"
        description="Off: nothing below goes into prompts and DayBoard stops learning from your edits."
        orientation="horizontal"
      >
        <Switch
          checked={settings.ai.memory}
          onCheckedChange={(memory) =>
            edit((draft) => {
              draft.ai.memory = memory;
            })
          }
          aria-label="Use memory"
        />
      </Field>
      {memories.isPending ? (
        <Field>
          <Status variant="loading">Loading…</Status>
        </Field>
      ) : memories.isError ? (
        <Field label="Memories" description={errorMessage(memories.error)} />
      ) : memories.data.length === 0 ? (
        <Field
          label="Nothing saved yet"
          description="Try “I prefer short replies” or “Keep Friday afternoons free.”"
        />
      ) : (
        <ul aria-label="Memories" className="flex flex-col">
          {[...memories.data].reverse().map((memory) => (
            <li key={memory.id}>
              <Field orientation="horizontal">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Text variant="regular">{memory.text}</Text>
                  <Text variant="small" color="secondary">
                    {SOURCE_LABEL[memory.source]}
                  </Text>
                </div>
                <Button
                  size="small"
                  variant="transparent"
                  aria-label={`Forget: ${memory.text}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(memory.id)}
                >
                  Forget
                </Button>
              </Field>
            </li>
          ))}
        </ul>
      )}
      <Field orientation="horizontal">
        <Input
          aria-label="New memory"
          className="flex-1"
          placeholder="Something DayBoard should remember…"
          value={text}
          maxLength={300}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save();
            }
          }}
        />
        <Button disabled={!text.trim() || add.isPending} onClick={save}>
          Remember
        </Button>
      </Field>
    </FieldSet>
  );
}

const CHART_DAYS = 14;
const TABLE_DAYS = 30;

/** Settings → AI → Usage: the requests and tokens DayBoard recorded, not provider plan limits. */
export function UsageSettings() {
  const usage = useUsage();
  const today = todayISO();
  if (usage.isPending) return null;
  const days = usage.data ?? [];
  const bars = usageBars(days, today, CHART_DAYS);
  const models = usageByModel(days, today, TABLE_DAYS);
  const peak = Math.max(1, ...bars.map((bar) => bar.runs));
  const runs = models.reduce((sum, model) => sum + model.runs, 0);
  const tokens = models.reduce((sum, model) => sum + model.inputTokens + model.outputTokens, 0);

  return (
    <FieldSet
      title="Usage"
      description="AI requests DayBoard made, from its own records. Your provider's plan limits aren't visible to DayBoard."
    >
      <Field
        label={`${runs} ${runs === 1 ? "request" : "requests"} · ${compactNumber(tokens)} tokens`}
        description="Last 30 days"
      >
        <div
          role="img"
          aria-label={`Requests per day for the last ${CHART_DAYS} days`}
          className="flex h-20 items-end gap-1"
        >
          {bars.map((bar) => (
            <div
              key={bar.date}
              title={`${bar.date}: ${bar.runs} ${bar.runs === 1 ? "request" : "requests"}, ${compactNumber(bar.tokens)} tokens`}
              className="flex-1 rounded-sm bg-accent"
              style={{
                height: `${bar.runs ? Math.max(6, (bar.runs / peak) * 100) : 2}%`,
              }}
            />
          ))}
        </div>
      </Field>
      {models.length ? (
        <table aria-label="Usage by model" className="mx-3 mb-2 text-regular">
          <thead>
            <tr className="text-small text-secondary">
              <th className="py-1 text-left font-normal">Model</th>
              <th className="py-1 text-right font-normal">Requests</th>
              <th className="py-1 text-right font-normal">Input</th>
              <th className="py-1 text-right font-normal">Output</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model}>
                <td className="max-w-0 truncate py-1 pr-2" title={model.model}>
                  {model.model}
                </td>
                <td className="py-1 text-right tabular-nums">{model.runs}</td>
                <td className="py-1 text-right tabular-nums">{compactNumber(model.inputTokens)}</td>
                <td className="py-1 text-right tabular-nums">
                  {compactNumber(model.outputTokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </FieldSet>
  );
}

function when(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? time
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function ActivityRow({ entry }: { entry: AgentActivityEntry }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <Text variant="small" color="secondary" className="w-28 shrink-0 tabular-nums">
        {when(entry.at)}
      </Text>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Text variant="small-mono" truncate>
            {entry.tool}
          </Text>
          {entry.write ? <Badge color="blue">Change</Badge> : null}
          {entry.ok ? null : <Badge color="red">Failed</Badge>}
        </div>
        <Text variant="small" color="secondary" truncate title={entry.error}>
          {entry.client}
          {entry.error ? ` · ${entry.error}` : ""}
        </Text>
      </div>
    </li>
  );
}

const ACTIVITY_ROWS = 200;

/** Settings → MCP Servers → Activity: every DayBoard tool an agent called in the last 30 days. */
export function ActivitySettings() {
  const activity = useActivity();
  const [changesOnly, setChangesOnly] = useState(false);
  const entries = (activity.data ?? []).filter((entry) => !changesOnly || entry.write);
  return (
    <FieldSet
      title="Activity"
      description="Each DayBoard tool the Assistant or an outside agent used in the last 30 days. Tool names and outcomes only; what they read or wrote isn't kept."
    >
      <Field label="Changes only" orientation="horizontal">
        <Switch
          checked={changesOnly}
          onCheckedChange={setChangesOnly}
          aria-label="Show changes only"
        />
      </Field>
      {activity.isPending ? (
        <Field>
          <Status variant="loading">Loading…</Status>
        </Field>
      ) : activity.isError ? (
        <Field label="Activity" description={errorMessage(activity.error)} />
      ) : entries.length === 0 ? (
        <Field
          label="No activity yet"
          description="Calls appear here when the Assistant or an MCP client uses DayBoard."
        />
      ) : (
        <ul aria-label="Agent activity" className="flex flex-col">
          {entries.slice(0, ACTIVITY_ROWS).map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </FieldSet>
  );
}
