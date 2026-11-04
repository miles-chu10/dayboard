export type LicenseStatus =
  | { state: "demo" }
  | { state: "disabled" }
  | { state: "unconfigured" }
  | { state: "trial"; daysLeft: number }
  | { state: "expired" }
  | { state: "invalid"; message: string; keyHint: string }
  | { state: "licensed"; keyHint: string }
  | { state: "network-error"; keyHint: string; lastValidatedAt: string };

export interface LicenseStatusPayload {
  status: LicenseStatus;
  checkoutUrl: string;
}

/** The license states that lock AI (the only paid feature). */
export type AiLockState = "expired" | "invalid" | "network-error";

/** States in which paid (AI) actions are blocked (prompt to buy / enter a key). */
export function isLicenseBlocking(
  status: LicenseStatus,
): status is Extract<LicenseStatus, { state: AiLockState }> {
  return (
    status.state === "expired" || status.state === "invalid" || status.state === "network-error"
  );
}
