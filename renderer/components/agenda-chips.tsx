import { cn } from "@glaze/core/utils";
import type { SourceId } from "@main/shared-types";

import { relativeDue } from "../lib/dates";
import { SourceDot } from "./source-dot";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-small";

/** KiteTasks-style list chip: source-colored dot and the list name. */
export function ListChip({ source, listTitle }: { source: SourceId; listTitle: string }) {
  return (
    <span className={cn(CHIP, "max-w-40 bg-control-subtle text-secondary")} title={listTitle}>
      <SourceDot source={source} className="size-1.5" />
      <span className="truncate">{listTitle}</span>
    </span>
  );
}

const DUE_TONE = {
  overdue: "bg-support-red-10 text-support-red",
  today: "bg-accent-10 text-accent",
  later: "bg-control-subtle text-secondary",
} as const;

/** Relative due label: accent for today, red once it's missed ("5 days ago"). */
export function DueChip({
  date,
  time,
  now = new Date(),
}: {
  date: string;
  time: string | null;
  now?: Date;
}) {
  const due = relativeDue(date, time, now);
  return <span className={cn(CHIP, "tabular-nums", DUE_TONE[due.tone])}>{due.label}</span>;
}
