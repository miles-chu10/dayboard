// Pure license state machine: trial countdown, revalidate-at-most-daily, 30-day offline grace,
// invalid-key detection. No Electron or Node imports, so tests/license-service.test.mjs can
// esbuild-bundle and unit-test it directly with an in-memory store and a mocked verifier (see
// tests/platform-oauth.test.mjs for the same pattern this mirrors).

import type { LicenseStatus } from "../../../shared/license.js";
import type { LicenseProductConfig } from "./config.js";
import type {
  LemonSqueezyLicenseInfo,
  LemonSqueezyLicenseMeta,
  LicenseVerifier,
} from "./lemonsqueezy-verifier.js";

export type { LicenseStatus } from "../../../shared/license.js";

export interface LicenseRecord {
  licenseKey: string | null;
  instanceId: string | null;
  instanceName: string | null;
  /** ISO timestamp of this device's first-ever launch; anchors the trial countdown. */
  firstLaunchAt: string;
  /** ISO timestamp of the last time we successfully reached Lemon Squeezy, valid or not. */
  lastValidationAt: string | null;
  lastValidationValid: boolean | null;
  lastValidationMessage: string | null;
  /** Proven merchant association from the last successful activation or validation. */
  productBinding?: LemonSqueezyLicenseMeta | null;
}

export interface LicenseStore {
  read(): Promise<LicenseRecord | null>;
  write(record: LicenseRecord): Promise<void>;
}

export interface LicenseServiceOptions {
  trialDays: number;
  revalidateIntervalMs: number;
  offlineGraceDays: number;
  gatingDisabled?: boolean;
  product?: LicenseProductConfig | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function keyHint(licenseKey: string): string {
  return licenseKey.slice(-4);
}

function defaultRecord(now: Date): LicenseRecord {
  return {
    licenseKey: null,
    instanceId: null,
    instanceName: null,
    firstLaunchAt: now.toISOString(),
    lastValidationAt: null,
    lastValidationValid: null,
    lastValidationMessage: null,
    productBinding: null,
  };
}

/** States in which AI actions and writes should be blocked (prompt to buy / enter a key). */
export function isLicenseBlocking(status: LicenseStatus): boolean {
  return (
    status.state === "expired" || status.state === "invalid" || status.state === "network-error"
  );
}

function matchesProduct(meta: LemonSqueezyLicenseMeta, expected: LicenseProductConfig): boolean {
  return (
    meta.storeId === expected.storeId &&
    meta.productId === expected.productId &&
    expected.variantIds.includes(meta.variantId)
  );
}

function isUnexpired(license: LemonSqueezyLicenseInfo, now: Date): boolean {
  return (
    license.expiresAt === null ||
    (Number.isFinite(Date.parse(license.expiresAt)) &&
      Date.parse(license.expiresAt) > now.getTime())
  );
}

function isUsableLicense(license: LemonSqueezyLicenseInfo, now: Date): boolean {
  return license.status === "active" && isUnexpired(license, now);
}

function isActivatableLicense(license: LemonSqueezyLicenseInfo, now: Date): boolean {
  return (
    (license.status === "inactive" || license.status === "active") && isUnexpired(license, now)
  );
}

export class LicenseService {
  private readonly verifier: LicenseVerifier;
  private readonly store: LicenseStore;
  private readonly options: LicenseServiceOptions;
  private pending: Promise<void> = Promise.resolve();

  constructor(verifier: LicenseVerifier, store: LicenseStore, options: LicenseServiceOptions) {
    this.verifier = verifier;
    this.store = store;
    this.options = options;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.pending.then(operation);
    this.pending = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private async readOrSeed(now: Date): Promise<LicenseRecord> {
    const existing = await this.store.read();
    if (existing) return existing;
    const seeded = defaultRecord(now);
    await this.store.write(seeded);
    return seeded;
  }

  private computeStatus(record: LicenseRecord, now: Date): LicenseStatus {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };

    if (!record.licenseKey) {
      const elapsedDays = Math.floor((now.getTime() - Date.parse(record.firstLaunchAt)) / DAY_MS);
      const daysLeft = Math.max(0, this.options.trialDays - elapsedDays);
      return daysLeft > 0 ? { state: "trial", daysLeft } : { state: "expired" };
    }

    const hint = keyHint(record.licenseKey);

    if (record.lastValidationValid === false) {
      return {
        state: "invalid",
        keyHint: hint,
        message: record.lastValidationMessage ?? "This license key is no longer valid.",
      };
    }

    if (
      record.lastValidationValid !== true ||
      !record.instanceId ||
      !record.productBinding ||
      !matchesProduct(record.productBinding, this.options.product)
    ) {
      return {
        state: "invalid",
        keyHint: hint,
        message: "This saved key needs to be verified for DayBoard.",
      };
    }

    if (record.lastValidationAt === null) {
      return {
        state: "invalid",
        keyHint: hint,
        message: "This saved key needs to be verified for DayBoard.",
      };
    }

    const graceMs = this.options.offlineGraceDays * DAY_MS;
    const ageMs = now.getTime() - Date.parse(record.lastValidationAt);
    if (!Number.isFinite(ageMs) || ageMs > graceMs) {
      return {
        state: "network-error",
        keyHint: hint,
        lastValidatedAt: record.lastValidationAt,
      };
    }
    return { state: "licensed", keyHint: hint };
  }

  /** Reads the cached record and computes status. Never makes a network call. */
  async getStatus(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };
    return this.serialize(async () => this.computeStatus(await this.readOrSeed(now), now));
  }

  /**
   * Revalidates against Lemon Squeezy at most once per `revalidateIntervalMs`; otherwise returns
   * the cached status untouched. A network failure leaves the record unchanged (so the 30-day
   * offline grace keeps counting from the last time we actually reached the server) and resolves
   * with the status computed from the stale record rather than rejecting.
   */
  async refresh(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };
    return this.serialize(() => this.refreshLocked(now));
  }

  private async refreshLocked(now: Date): Promise<LicenseStatus> {
    const record = await this.readOrSeed(now);
    if (!record.licenseKey) return this.computeStatus(record, now);

    const due =
      record.lastValidationAt === null ||
      !Number.isFinite(Date.parse(record.lastValidationAt)) ||
      !record.instanceId ||
      !record.productBinding ||
      now.getTime() - Date.parse(record.lastValidationAt) >= this.options.revalidateIntervalMs;
    if (!due) return this.computeStatus(record, now);

    let result;
    try {
      result = await this.verifier.validate(record.licenseKey, record.instanceId ?? undefined);
    } catch {
      // Network/server unreachable: don't flip validity, just report the current (possibly
      // grace-period) status computed from the unchanged record.
      return this.computeStatus(record, now);
    }
    if (result.valid && (!result.meta || !result.license || !result.instanceId)) {
      return this.computeStatus(record, now);
    }
    const valid =
      result.valid &&
      result.instanceId === record.instanceId &&
      matchesProduct(result.meta!, this.options.product!) &&
      isUsableLicense(result.license!, now);
    const next: LicenseRecord = {
      ...record,
      lastValidationAt: now.toISOString(),
      lastValidationValid: valid,
      lastValidationMessage: valid
        ? null
        : result.valid
          ? "This license key is for another product or is no longer active."
          : (result.error ?? "This license key is no longer valid."),
      productBinding: valid ? result.meta : null,
    };
    await this.store.write(next);
    return this.computeStatus(next, now);
  }

  async activate(
    licenseKey: string,
    instanceName: string,
    now = new Date(),
  ): Promise<LicenseStatus> {
    if (this.options.gatingDisabled)
      throw new Error("License activation is disabled for this build.");
    if (!this.options.product)
      throw new Error("License activation is not configured for this build.");
    return this.serialize(() => this.activateLocked(licenseKey, instanceName, now));
  }

  private async activateLocked(
    licenseKey: string,
    instanceName: string,
    now: Date,
  ): Promise<LicenseStatus> {
    const trimmed = licenseKey.trim();
    if (!trimmed) throw new Error("Enter a license key.");

    // A key-level validation has no instance and consumes no activation slot.
    const preflight = await this.verifier.validate(trimmed);
    if (!preflight.valid) {
      throw new Error(preflight.error ?? "That license key couldn't be validated.");
    }
    if (!preflight.meta || !preflight.license) {
      throw new Error("Lemon Squeezy returned an incomplete validation response.");
    }
    if (
      !matchesProduct(preflight.meta, this.options.product!) ||
      !isActivatableLicense(preflight.license, now)
    ) {
      throw new Error("That license key is for another product or is no longer active.");
    }

    // Fail on an unreadable store before creating the remote instance.
    const record = (await this.store.read()) ?? defaultRecord(now);
    const result = await this.verifier.activate(trimmed, instanceName);
    if (!result.activated) {
      throw new Error(result.error ?? "That license key couldn't be activated.");
    }
    if (typeof result.instanceId !== "string" || !result.instanceId.trim()) {
      throw new Error(
        "Lemon Squeezy did not identify the new activation; it may need manual release.",
      );
    }
    if (
      !result.meta ||
      !result.license ||
      !matchesProduct(result.meta, this.options.product!) ||
      !isUsableLicense(result.license, now)
    ) {
      return this.rejectCreatedInstance(
        trimmed,
        result.instanceId,
        "The activation response did not match DayBoard",
      );
    }
    const next: LicenseRecord = {
      ...record,
      licenseKey: trimmed,
      instanceId: result.instanceId,
      instanceName,
      lastValidationAt: now.toISOString(),
      lastValidationValid: true,
      lastValidationMessage: null,
      productBinding: result.meta,
    };
    try {
      await this.store.write(next);
    } catch {
      return this.rejectCreatedInstance(
        trimmed,
        result.instanceId,
        "DayBoard could not save the license activation",
      );
    }
    return this.computeStatus(next, now);
  }

  private async rejectCreatedInstance(
    licenseKey: string,
    instanceId: string,
    reason: string,
  ): Promise<never> {
    let released = false;
    try {
      const cleanup = await this.verifier.deactivate(licenseKey, instanceId);
      released = cleanup.deactivated;
    } catch {
      // Preserve the primary failure while still reporting the uncertain activation slot.
    }
    throw new Error(
      released
        ? `${reason}; the new activation was released.`
        : `${reason}; the activation may still occupy a slot. Contact support if needed.`,
    );
  }

  /**
   * Best-effort remote deactivation (frees the Lemon Squeezy activation slot); the key is always
   * cleared locally afterward, even if the remote call fails, so an offline device isn't stuck
   * unable to remove a key it can no longer reach the server about.
   */
  async deactivate(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled)
      throw new Error("License deactivation is disabled for this build.");
    if (!this.options.product)
      throw new Error("License deactivation is not configured for this build.");
    return this.serialize(() => this.deactivateLocked(now));
  }

  private async deactivateLocked(now: Date): Promise<LicenseStatus> {
    const record = await this.readOrSeed(now);
    if (record.licenseKey && record.instanceId) {
      try {
        await this.verifier.deactivate(record.licenseKey, record.instanceId);
      } catch {
        // best-effort; fall through to local clear regardless
      }
    }
    const next: LicenseRecord = {
      ...record,
      licenseKey: null,
      instanceId: null,
      instanceName: null,
      lastValidationAt: null,
      lastValidationValid: null,
      lastValidationMessage: null,
      productBinding: null,
    };
    await this.store.write(next);
    return this.computeStatus(next, now);
  }
}
