/** Version 1 contract shared by the desktop app and the DayBoard Stripe license service. */
export type LicenseEnvironment = "test" | "live";

export interface LicenseBinding {
  issuer: string;
  productId: string;
  environment: LicenseEnvironment;
}

export interface LicenseInfo {
  status: "active" | "inactive" | "revoked";
  expiresAt: string | null;
}

export interface ActivateLicenseRequest {
  licenseKey: string;
  installationId: string;
  instanceName: string;
}
export interface ValidateLicenseRequest {
  licenseKey: string;
  instanceId?: string;
}
export interface DeactivateLicenseRequest {
  licenseKey: string;
  instanceId: string;
}

export interface ActivateResult {
  activated: boolean;
  /** True only if this request created a new activation, for safe failed-save compensation. */
  created?: boolean;
  instanceId?: string;
  license?: LicenseInfo;
  meta?: LicenseBinding;
  error?: string;
}
export interface ValidateResult {
  valid: boolean;
  instanceId?: string;
  license?: LicenseInfo;
  meta?: LicenseBinding;
  error?: string;
}
export interface DeactivateResult {
  deactivated: boolean;
  error?: string;
}

export interface LicenseVerifier {
  activate(
    licenseKey: string,
    installationId: string,
    instanceName: string,
  ): Promise<ActivateResult>;
  validate(licenseKey: string, instanceId?: string): Promise<ValidateResult>;
  deactivate(licenseKey: string, instanceId: string): Promise<DeactivateResult>;
}

/** A key is an opaque, random 256-bit capability; Stripe API keys are never accepted here. */
export const LICENSE_KEY_PATTERN = /^DAYB_[A-Za-z0-9_-]{43}$/;
export const INSTALLATION_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface CheckoutStatus {
  state: "pending" | "ready" | "failed" | "revoked";
}
export interface CheckoutClaim {
  licenseKey: string;
}
