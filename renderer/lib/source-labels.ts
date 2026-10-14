import type { SourceId } from "@main/shared-types";

/** Kept apart from sources.ts, which needs React, so prompt builders and their tests can load it. */
export const SOURCE_LABEL: Record<SourceId, string> = {
  tasks: "Google Tasks",
  reminders: "Apple Reminders",
  mail: "Gmail",
  calendar: "Calendar",
};
