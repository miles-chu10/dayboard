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
  /**
   * A key this Mac stopped using is still kept, encrypted, because the license service hasn't
   * confirmed its activation slot is free. Absent or false when nothing is waiting.
   */
  releasePending?: boolean;
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
 * "released": the license service confirmed the activation slot is free.
 * "pending": the key is no longer used here, but the service hasn't confirmed the slot is free.
 * "none": there was nothing this service could release, e.g. a key it never verified.
 */
export type LicenseRelease = "released" | "pending" | "none";

export interface LicenseDeactivationPayload extends LicenseStatusPayload {
  release: LicenseRelease;
}

/**
 * Macs one DayBoard Pro key can be active on at once, as the app words it. The license service
 * enforces its own ACTIVATION_LIMIT; keep the two equal (docs/RELEASE.md).
 */
export const LICENSE_ACTIVATION_LIMIT = 3;
export const LICENSE_SUPPORT_EMAIL = "support@getdayboard.com";
/** The label every activation sends to the license service. */
export const LICENSE_INSTANCE_NAME = "DayBoard on macOS";

/** `license:reset` runs only with this exact argument, sent after the user confirms. */
export const LICENSE_RESET_CONFIRMATION = "reset-license-data-on-this-mac";
/** `license:forget-release` runs only with this exact argument, sent after the user confirms. */
export const LICENSE_FORGET_CONFIRMATION = "forget-license-key-without-releasing";
