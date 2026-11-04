import type { AiLockState } from "./license.js";

// Only AI is paid. Tasks, reminders, calendar, mail, linked duplicates and settings stay free
// forever. Quick Capture is free too: a manual capture never reaches AI, so `capture:submit` is not
// gated here; its AI parse checks the license itself, right before the AI call (capture-service.ts).
// Learning a preference from a reply draft is an AI call too; saving or deleting a memory is free.
const PAID_CHANNELS = new Set(["ai:run", "ai:assistant", "assistant:transcribe", "memory:learn"]);

export function requiresLicenseAccess(channel: string): boolean {
  return PAID_CHANNELS.has(channel);
}

const LICENSE_REQUIRED = "license-required";
const AI_LOCK_STATES: readonly string[] = ["expired", "invalid", "network-error"];

/** What the license guard throws while AI is locked; `state` says why. */
export class LicenseRequiredError extends Error {
  readonly code = LICENSE_REQUIRED;
  readonly state: AiLockState;

  constructor(state: AiLockState) {
    super("License required for this action. Open Settings → License to continue.");
    this.name = "LicenseRequiredError";
    this.state = state;
  }
}

/**
 * The lock state behind a license-guard rejection, or null for any other error (such as the
 * license status not being ready). Reads the code, not the class, so it holds across bundles.
 */
export function aiLockState(error: unknown): AiLockState | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, state } = error as { code?: unknown; state?: unknown };
  return code === LICENSE_REQUIRED && typeof state === "string" && AI_LOCK_STATES.includes(state)
    ? (state as AiLockState)
    : null;
}
