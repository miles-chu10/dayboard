// Only AI is paid. Tasks, reminders, calendar, mail, linked duplicates and settings stay free
// forever. Quick Capture is free too: a manual capture never reaches AI, so `capture:submit` is not
// gated here; its AI parse checks the license itself, right before the AI call (capture-service.ts).
// Learning a preference from a reply draft is an AI call too; saving or deleting a memory is free.
const PAID_CHANNELS = new Set(["ai:run", "ai:assistant", "assistant:transcribe", "memory:learn"]);

export function requiresLicenseAccess(channel: string): boolean {
  return PAID_CHANNELS.has(channel);
}
