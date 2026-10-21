import { Bell, CalendarDays, ListTodo, Mail, X } from "lucide-react";

import type { AssistantMention } from "../../shared/assistant-history";

const ICONS = { event: CalendarDays, task: ListTodo, reminder: Bell, email: Mail };
const KIND_NAME = { event: "Event", task: "Task", reminder: "Reminder", email: "Email" };

export function MentionIcon({ kind }: { kind: AssistantMention["kind"] }) {
  const Icon = ICONS[kind];
  return <Icon className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />;
}

/** A mentioned item: removable in the composer, read-only on a sent message. */
export function MentionChip({
  kind,
  label,
  onRemove,
}: AssistantMention & { onRemove?: () => void }) {
  return (
    <span
      title={`${KIND_NAME[kind]}: ${label}`}
      className="inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md bg-control-subtle pl-2 pr-0.5 text-small"
    >
      <MentionIcon kind={kind} />
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="flex size-5 items-center justify-center rounded text-tertiary hover:bg-control focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1.5" aria-hidden="true" />
      )}
    </span>
  );
}
