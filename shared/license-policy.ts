// Only AI is paid. Tasks, reminders, calendar, mail, linked duplicates and settings stay free
// forever. Quick Capture parses its text with AI, so submitting one is an AI action; undoing a
// capture that already ran stays free.
// Learning a preference from a reply draft is an AI call too; saving or deleting a memory is free.
const PAID_CHANNELS = new Set([
  "ai:run",
  "ai:assistant",
  "assistant:transcribe",
  "capture:submit",
  "memory:learn",
]);

export function requiresLicenseAccess(channel: string): boolean {
  return PAID_CHANNELS.has(channel);
}
