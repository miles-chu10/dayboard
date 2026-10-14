/** Kept apart from triage.ts, which needs React, so prompt builders and their tests can load it. */
export type TriageCategory = "needs-reply" | "fyi" | "ignore";

export interface TriageResult {
  category: TriageCategory;
  reason: string;
  task: string;
}

export type TriageMap = Record<string, TriageResult>;
