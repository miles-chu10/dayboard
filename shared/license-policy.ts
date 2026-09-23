// Read access, preferences and account recovery remain available after a trial ends.
const PAID_CHANNELS = new Set([
  "tasks:create",
  "tasks:setCompleted",
  "tasks:update",
  "tasks:delete",
  "reminders:create",
  "reminders:setCompleted",
  "reminders:update",
  "reminders:delete",
  "calendar:create",
  "calendar:update",
  "calendar:delete",
  "agenda:createBlock",
  "mail:markRead",
  "mail:archive",
  "mail:createDraft",
  "ai:run",
  "ai:assistant",
  "assistant:transcribe",
]);

export function requiresLicenseAccess(channel: string): boolean {
  return PAID_CHANNELS.has(channel);
}
