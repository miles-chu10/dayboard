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
