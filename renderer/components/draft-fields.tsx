import { Field, FieldGroup, Input, SegmentedControl, SegmentedControlItem } from "@renderer/ui";

import { KIND_SOURCE, type ItemDraft, type ItemKind } from "../lib/create-items";
import { SourceDot } from "./source-dot";

/** Type, title, date and time fields for one new item; shared by ⌘N and Quick Capture. */
export function DraftFields({
  draft,
  available,
  autoFocusTitle,
  onChange,
}: {
  draft: ItemDraft;
  available: Record<ItemKind, boolean>;
  autoFocusTitle: boolean;
  onChange: (patch: Partial<ItemDraft>) => void;
}) {
  return (
    <FieldGroup>
      <Field label="Type">
        <SegmentedControl
          size="small"
          value={draft.kind}
          onValueChange={(value: string) => onChange({ kind: value as ItemKind })}
          aria-label="Item type"
        >
          {(["task", "reminder", "event"] as const).map((kind) => (
            <SegmentedControlItem key={kind} value={kind} disabled={!available[kind]}>
              <span className="flex items-center gap-1.5">
                <SourceDot source={KIND_SOURCE[kind]} />
                {kind === "task" ? "Task" : kind === "reminder" ? "Reminder" : "Event"}
              </span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </Field>
      <Field label="Title">
        <Input
          className="w-64"
          autoFocus={autoFocusTitle}
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </Field>
      <Field
        label={draft.kind === "event" ? "Date" : "Due"}
        description={draft.kind === "event" && !draft.date ? "Events need a date." : undefined}
      >
        <Input
          type="date"
          className="w-64"
          value={draft.date}
          onChange={(event) => onChange({ date: event.target.value })}
        />
      </Field>
      {draft.kind !== "task" ? (
        <Field
          label={draft.kind === "event" ? "Starts" : "Time"}
          description={draft.kind === "event" ? "Leave empty for an all-day event." : undefined}
        >
          <Input
            type="time"
            className="w-64"
            value={draft.time}
            onChange={(event) => onChange({ time: event.target.value })}
          />
        </Field>
      ) : null}
      {draft.kind === "event" && draft.time ? (
        <Field label="Ends" description="Defaults to one hour.">
          <Input
            type="time"
            className="w-64"
            value={draft.endTime}
            onChange={(event) => onChange({ endTime: event.target.value })}
          />
        </Field>
      ) : null}
    </FieldGroup>
  );
}
