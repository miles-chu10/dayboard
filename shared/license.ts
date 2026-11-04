export type LicenseStatus =
  | { state: "demo" }
  | { state: "disabled" }
  | { state: "unconfigured" }
  | { state: "trial"; daysLeft: number }
  | { state: "expired" }
  | { state: "invalid"; message: string; keyHint: string }
  | { state: "licensed"; keyHint: string }
  | { state: "network-error"; keyHint: string; lastValidatedAt: string }
  /** The license file on this Mac exists but can't be decrypted or parsed. */
  | { state: "unreadable" };

export interface LicenseStatusPayload {
  status: LicenseStatus;
  checkoutUrl: string;
}

/** The license states that lock AI (the only paid feature). */
export type AiLockState = "expired" | "invalid" | "network-error" | "unreadable";

/** States in which paid (AI) actions are blocked (prompt to buy / enter a key). */
export function isLicenseBlocking(
  status: LicenseStatus,
): status is Extract<LicenseStatus, { state: AiLockState }> {
  return (
    status.state === "expired" ||
    status.state === "invalid" ||
    status.state === "network-error" ||
    status.state === "unreadable"
  );
}

/**
 * "released": the license service confirmed this Mac holds no activation slot.
 * "pending": the key is gone from this Mac, but the service hasn't confirmed the slot is free.
 */
export type LicenseRelease = "released" | "pending";

export interface LicenseDeactivationPayload extends LicenseStatusPayload {
  release: LicenseRelease;
}

/** Macs one DayBoard Pro key can be active on at once. Matches the license service's ACTIVATION_LIMIT. */
export const LICENSE_ACTIVATION_LIMIT = 3;
export const LICENSE_SUPPORT_EMAIL = "support@getdayboard.com";

/** `license:reset` runs only with this exact argument, sent after the user confirms. */
export const LICENSE_RESET_CONFIRMATION = "reset-license-data-on-this-mac";
