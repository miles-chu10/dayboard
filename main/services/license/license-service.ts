// Pure license state machine: AI trial countdown (starts on first paid-feature use), revalidate-at-most-daily, 30-day offline grace,
// invalid-key detection, unconfirmed slot releases and unreadable-record recovery. No Electron
// imports, so tests/license-service.test.mjs can esbuild-bundle and unit-test it with an
// in-memory store and a mocked verifier.

import type { LicenseRelease, LicenseStatus } from "../../../shared/license.js";
import { LICENSE_SUPPORT_EMAIL } from "../../../shared/license.js";
import { randomUUID } from "node:crypto";
import { INSTALLATION_ID_PATTERN, LICENSE_KEY_PATTERN } from "../../../shared/license-contract.js";
import type {
  LicenseBinding,
  LicenseInfo,
  LicenseVerifier,
} from "../../../shared/license-contract.js";
import type { DesktopLicenseConfig } from "../../../shared/license-config.js";

export type { LicenseStatus } from "../../../shared/license.js";
export { isLicenseBlocking } from "../../../shared/license.js";

/** An activation removed from this Mac whose release the license service hasn't confirmed. */
export interface PendingRelease {
  licenseKey: string;
  instanceId: string;
  binding: LicenseBinding;
}

export interface LicenseRecord {
  version: 2;
  installationId: string;
  licenseKey: string | null;
  instanceId: string | null;
  instanceName: string | null;
  /** ISO timestamp of this device's first paid-feature (AI) use; anchors the trial countdown. */
  firstLaunchAt: string;
  /** ISO timestamp of the last authoritative validation. */
  lastValidationAt: string | null;
  lastValidationValid: boolean | null;
  lastValidationMessage: string | null;
  /** Proven service association from the last successful activation or validation. */
  productBinding: LicenseBinding | null;
  /** Releases to retry. Absent in records saved before this field existed. */
  pendingReleases?: PendingRelease[];
}

export interface LicenseStore {
  read(): Promise<LicenseRecord | null>;
  write(record: LicenseRecord): Promise<void>;
  /**
   * Keeps the unreadable saved file as a timestamped backup, then saves `record` in its place.
   * Needed only by stores whose `read` can throw `UnreadableLicenseRecordError`.
   */
  replaceUnreadable?(record: LicenseRecord): Promise<void>;
}

export interface LicenseServiceOptions {
  trialDays: number;
  revalidateIntervalMs: number;
  offlineGraceDays: number;
  gatingDisabled?: boolean;
  product?: DesktopLicenseConfig | null;
  /** Macs one key can be active on, named in the activation-limit message. */
  activationLimit?: number;
  /** Installation ID for new records (per Mac in the app). A missing or malformed one is random. */
  installationId?: () => Promise<string>;
}

export interface LicenseDeactivation {
  status: LicenseStatus;
  release: LicenseRelease;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** After a background release fails, refreshes wait this long before trying it again. */
const RELEASE_RETRY_MS = 15 * 60 * 1000;
export const MAX_PENDING_RELEASES = 8;
const REVOKED_MESSAGE = "This license has been revoked and can't unlock DayBoard Pro.";
const UNREADABLE_MESSAGE =
  "DayBoard can't read the license data saved on this Mac. Open Settings → License to reset it or enter your license key again.";
const UNREADABLE_CODE = "LICENSE_RECORD_UNREADABLE";

/** The saved license file exists but can't be decrypted or parsed, e.g. after a lost Keychain item. */
export class UnreadableLicenseRecordError extends Error {
  readonly code = UNREADABLE_CODE;
}

/** Checks the code rather than the class, so separately bundled stores are recognized too. */
export function isUnreadableLicenseRecord(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === UNREADABLE_CODE;
}

function keyHint(licenseKey: string): string {
  return licenseKey.slice(-4);
}

function defaultRecord(now: Date, installationId: string): LicenseRecord {
  return {
    version: 2,
    installationId,
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

function activationLimitMessage(limit: number | undefined): string {
  const reached =
    limit !== undefined && Number.isInteger(limit) && limit > 0
      ? `This license key is already active on ${limit} Mac${limit === 1 ? "" : "s"}, the most one key allows.`
      : "This license key is already active on the maximum number of Macs.";
  return `${reached} To free a slot, open DayBoard on one of those Macs and choose Settings → License → Deactivate this device, then activate here again. If one of them is lost, erased or no longer works, email ${LICENSE_SUPPORT_EMAIL} to free its slot.`;
}

function withRelease(pending: PendingRelease[], release: PendingRelease): PendingRelease[] {
  const others = pending.filter((item) => item.instanceId !== release.instanceId);
  return [...others, release].slice(-MAX_PENDING_RELEASES);
}

function matchesProduct(meta: LicenseBinding, expected: DesktopLicenseConfig): boolean {
  return (
    meta.issuer === expected.issuer &&
    meta.productId === expected.productId &&
    meta.environment === expected.environment
  );
}

function isUnexpired(license: LicenseInfo, now: Date): boolean {
  return (
    license.expiresAt === null ||
    (Number.isFinite(Date.parse(license.expiresAt)) &&
      Date.parse(license.expiresAt) > now.getTime())
  );
}

function isUsableLicense(license: LicenseInfo, now: Date): boolean {
  return license.status === "active" && isUnexpired(license, now);
}

function isActivatableLicense(license: LicenseInfo, now: Date): boolean {
  return (
    (license.status === "inactive" || license.status === "active") && isUnexpired(license, now)
  );
}

export class LicenseService {
  private readonly verifier: LicenseVerifier;
  private readonly store: LicenseStore;
  private readonly options: LicenseServiceOptions;
  private pending: Promise<void> = Promise.resolve();
  /** In memory, so the first refresh after each launch retries unconfirmed releases. */
  private nextReleaseRetryAt = 0;

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

  private async newRecord(now: Date): Promise<LicenseRecord> {
    let installationId: string | undefined;
    try {
      installationId = await this.options.installationId?.();
    } catch {
      // A random identity still works; it just can't be shared by other profiles on this Mac.
    }
    return defaultRecord(
      now,
      installationId && INSTALLATION_ID_PATTERN.test(installationId)
        ? installationId
        : randomUUID(),
    );
  }

  private async readOrSeed(now: Date): Promise<LicenseRecord> {
    const existing = await this.store.read();
    if (existing) return existing;
    const seeded = await this.newRecord(now);
    await this.store.write(seeded);
    return seeded;
  }

  private async replaceUnreadable(record: LicenseRecord): Promise<void> {
    if (!this.store.replaceUnreadable) throw new Error(UNREADABLE_MESSAGE);
    await this.store.replaceUnreadable(record);
  }

  /** An unreadable record blocks AI until the user re-enters a key or resets license data. */
  private async unlessUnreadable(operation: () => Promise<LicenseStatus>): Promise<LicenseStatus> {
    try {
      return await operation();
    } catch (error) {
      if (isUnreadableLicenseRecord(error)) return { state: "unreadable" };
      throw error;
    }
  }

  /** The current activation, if this build's service can release it. */
  private releasableActivation(record: LicenseRecord): PendingRelease | null {
    return record.licenseKey &&
      record.instanceId &&
      LICENSE_KEY_PATTERN.test(record.licenseKey) &&
      record.productBinding &&
      matchesProduct(record.productBinding, this.options.product!)
      ? {
          licenseKey: record.licenseKey,
          instanceId: record.instanceId,
          binding: record.productBinding,
        }
      : null;
  }

  /**
   * Any complete answer settles a release: the service freed the slot, or it holds none for this
   * key (revoked, or an unknown key or instance). Only an unreachable service leaves it pending.
   */
  private async release({ licenseKey, instanceId }: PendingRelease): Promise<boolean> {
    try {
      await this.verifier.deactivate(licenseKey, instanceId);
      return true;
    } catch {
      return false;
    }
  }

  /** Retries this build's pending releases and returns the ones still unconfirmed. */
  private async settleReleases(
    record: LicenseRecord,
  ): Promise<{ record: LicenseRecord; unconfirmed: PendingRelease[] }> {
    const pending = record.pendingReleases ?? [];
    const unconfirmed: PendingRelease[] = [];
    for (const item of pending) {
      if (!matchesProduct(item.binding, this.options.product!) || !(await this.release(item)))
        unconfirmed.push(item);
    }
    if (unconfirmed.length === pending.length) return { record, unconfirmed };
    const next: LicenseRecord = { ...record, pendingReleases: unconfirmed };
    try {
      await this.store.write(next);
      return { record: next, unconfirmed };
    } catch {
      // The service already confirmed; releasing the same instance again later is harmless.
      return { record, unconfirmed };
    }
  }

  private releaseState(unconfirmed: PendingRelease[]): LicenseRelease {
    return unconfirmed.some((item) => matchesProduct(item.binding, this.options.product!))
      ? "pending"
      : "released";
  }

  /** Before the first AI use nothing is stored, so the full trial is still ahead. */
  private computeStatus(record: LicenseRecord | null, now: Date): LicenseStatus {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };
    if (!record) return { state: "trial", daysLeft: this.options.trialDays };

    if (!record.licenseKey) {
      const elapsedMs = now.getTime() - Date.parse(record.firstLaunchAt);
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { state: "expired" };
      const elapsedDays = Math.floor(elapsedMs / DAY_MS);
      const daysLeft = Math.max(0, this.options.trialDays - elapsedDays);
      return daysLeft > 0 ? { state: "trial", daysLeft } : { state: "expired" };
    }

    const hint = keyHint(record.licenseKey);

    // A rejection from the service clears the binding, so report its reason before the
    // binding check below would replace it with a generic "needs to be verified".
    if (record.lastValidationValid === false && LICENSE_KEY_PATTERN.test(record.licenseKey)) {
      return {
        state: "invalid",
        keyHint: hint,
        message: record.lastValidationMessage ?? "This license key is no longer valid.",
      };
    }

    if (
      !LICENSE_KEY_PATTERN.test(record.licenseKey) ||
      !record.productBinding ||
      !matchesProduct(record.productBinding, this.options.product)
    ) {
      return {
        state: "invalid",
        keyHint: hint,
        message: "This saved key needs to be verified for DayBoard.",
      };
    }

    if (
      record.lastValidationValid !== true ||
      !record.instanceId ||
      !INSTALLATION_ID_PATTERN.test(record.installationId)
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
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > graceMs) {
      return {
        state: "network-error",
        keyHint: hint,
        lastValidatedAt: record.lastValidationAt,
      };
    }
    return { state: "licensed", keyHint: hint };
  }

  /** Reads the cached record and computes status. Never makes a network call or starts the trial. */
  async getStatus(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };
    return this.serialize(() =>
      this.unlessUnreadable(async () => this.computeStatus(await this.store.read(), now)),
    );
  }

  /** Starts the trial clock on the first paid-feature use; later calls leave it unchanged. */
  async startTrial(now = new Date()): Promise<void> {
    if (this.options.gatingDisabled || !this.options.product) return;
    await this.serialize(async () => {
      try {
        await this.readOrSeed(now);
      } catch (error) {
        // The access check that follows reports the unreadable state.
        if (!isUnreadableLicenseRecord(error)) throw error;
      }
    });
  }

  /**
   * Revalidates against the DayBoard service at most once per `revalidateIntervalMs`; otherwise returns
   * the cached status untouched. A network failure leaves the record unchanged (so the 30-day
   * offline grace keeps counting from the last time we actually reached the server) and resolves
   * with the status computed from the stale record rather than rejecting. Unconfirmed slot
   * releases are retried first, at most once per `RELEASE_RETRY_MS` after a failure.
   */
  async refresh(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };
    return this.serialize(() => this.unlessUnreadable(() => this.refreshLocked(now)));
  }

  private async refreshLocked(now: Date): Promise<LicenseStatus> {
    let record = await this.store.read();
    if (record?.pendingReleases?.length && now.getTime() >= this.nextReleaseRetryAt) {
      const settled = await this.settleReleases(record);
      record = settled.record;
      this.nextReleaseRetryAt = settled.unconfirmed.length ? now.getTime() + RELEASE_RETRY_MS : 0;
    }
    if (!record?.licenseKey) return this.computeStatus(record, now);
    if (
      !LICENSE_KEY_PATTERN.test(record.licenseKey) ||
      !record.productBinding ||
      !matchesProduct(record.productBinding, this.options.product!)
    )
      return this.computeStatus(record, now);

    const due =
      record.lastValidationAt === null ||
      !Number.isFinite(Date.parse(record.lastValidationAt)) ||
      !record.instanceId ||
      !record.productBinding ||
      now.getTime() - Date.parse(record.lastValidationAt) < 0 ||
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
    if (!result.valid && !result.error) return this.computeStatus(record, now);
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
          : result.error === "revoked"
            ? REVOKED_MESSAGE
            : "This license key is no longer valid.",
      productBinding: valid ? result.meta! : null,
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
    if (!LICENSE_KEY_PATTERN.test(trimmed)) throw new Error("Enter a DayBoard license key.");

    // A key-level validation has no instance and consumes no activation slot.
    const preflight = await this.verifier.validate(trimmed);
    if (!preflight.valid) {
      if (preflight.error === "revoked") throw new Error(REVOKED_MESSAGE);
      throw new Error("That license key couldn't be validated.");
    }
    if (!preflight.meta || !preflight.license) {
      throw new Error("The DayBoard license service returned an incomplete validation response.");
    }
    if (
      !matchesProduct(preflight.meta, this.options.product!) ||
      !isActivatableLicense(preflight.license, now)
    ) {
      throw new Error("That license key is for another product or is no longer active.");
    }

    // Persist a stable installation identity before any activation request. A lost response can
    // be retried with the same identity without consuming another slot. A record that can't be
    // read is kept as a backup and replaced; this Mac's installation ID keeps its slot.
    let existing: LicenseRecord | null = null;
    let unreadable = false;
    try {
      existing = await this.store.read();
    } catch (error) {
      if (!isUnreadableLicenseRecord(error)) throw error;
      unreadable = true;
    }
    let record = existing ?? (await this.newRecord(now));
    if (unreadable) {
      await this.replaceUnreadable(record);
    } else if (record.version !== 2 || !INSTALLATION_ID_PATTERN.test(record.installationId)) {
      record = { ...(await this.newRecord(now)), firstLaunchAt: record.firstLaunchAt };
      await this.store.write(record);
    } else if (!existing) {
      await this.store.write(record);
    }

    const result = await this.verifier.activate(trimmed, record.installationId, instanceName);
    if (!result.activated) {
      if (result.error === "revoked") throw new Error(REVOKED_MESSAGE);
      if (result.error === "activation_limit")
        throw new Error(activationLimitMessage(this.options.activationLimit));
      throw new Error("That license key couldn't be activated.");
    }
    if (typeof result.instanceId !== "string" || !result.instanceId.trim()) {
      throw new Error(
        "The DayBoard service did not identify the activation; it may need manual release.",
      );
    }
    if (typeof result.created !== "boolean") {
      throw new Error("The DayBoard service did not report whether the activation was created.");
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
        result.created === true,
        "The activation response did not match DayBoard",
      );
    }
    // The activation now in use must never be released by a retry; a replaced one must be.
    const previous = this.releasableActivation(record);
    let pendingReleases = (record.pendingReleases ?? []).filter(
      (item) => item.instanceId !== result.instanceId,
    );
    if (previous && (previous.licenseKey !== trimmed || previous.instanceId !== result.instanceId))
      pendingReleases = withRelease(pendingReleases, previous);
    const next: LicenseRecord = {
      ...record,
      licenseKey: trimmed,
      instanceId: result.instanceId,
      instanceName,
      lastValidationAt: now.toISOString(),
      lastValidationValid: true,
      lastValidationMessage: null,
      productBinding: result.meta,
      pendingReleases,
    };
    try {
      await this.store.write(next);
    } catch {
      return this.rejectCreatedInstance(
        trimmed,
        result.instanceId,
        result.created === true,
        "DayBoard could not save the license activation",
      );
    }
    const settled = pendingReleases.length ? (await this.settleReleases(next)).record : next;
    return this.computeStatus(settled, now);
  }

  private async rejectCreatedInstance(
    licenseKey: string,
    instanceId: string,
    created: boolean,
    reason: string,
  ): Promise<never> {
    if (!created)
      throw new Error(`${reason}; retry with the same installation to recover the activation.`);
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
        : `${reason}; the activation may still occupy a slot. If you run out of slots, email ${LICENSE_SUPPORT_EMAIL}.`,
    );
  }

  /**
   * Removes the key from this Mac, then asks the service to free its slot. The local clear (with
   * the release recorded for retry) is committed first, so a failed save keeps a valid license and
   * never releases its remote instance. `release` says whether the service confirmed the slot is
   * free; also used to retry releases the service hasn't confirmed yet.
   */
  async deactivate(now = new Date()): Promise<LicenseDeactivation> {
    if (this.options.gatingDisabled)
      throw new Error("License deactivation is disabled for this build.");
    if (!this.options.product)
      throw new Error("License deactivation is not configured for this build.");
    return this.serialize(() => this.deactivateLocked(now));
  }

  private async deactivateLocked(now: Date): Promise<LicenseDeactivation> {
    let record: LicenseRecord;
    try {
      record = await this.readOrSeed(now);
    } catch (error) {
      if (isUnreadableLicenseRecord(error)) throw new Error(UNREADABLE_MESSAGE);
      throw error;
    }
    const current = this.releasableActivation(record);
    const pending = record.pendingReleases ?? [];
    const next: LicenseRecord = {
      ...record,
      licenseKey: null,
      instanceId: null,
      instanceName: null,
      lastValidationAt: null,
      lastValidationValid: null,
      lastValidationMessage: null,
      productBinding: null,
      pendingReleases: current ? withRelease(pending, current) : pending,
    };
    await this.store.write(next);
    const settled = await this.settleReleases(next);
    this.nextReleaseRetryAt = settled.unconfirmed.length ? now.getTime() + RELEASE_RETRY_MS : 0;
    return {
      status: this.computeStatus(settled.record, now),
      release: this.releaseState(settled.unconfirmed),
    };
  }

  /**
   * Recovery for a license file that can't be decrypted or parsed: keeps it as a backup and starts
   * a fresh record with this Mac's installation ID. A readable record is left untouched.
   */
  async resetUnreadable(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) throw new Error("License data is disabled for this build.");
    if (!this.options.product) throw new Error("License data is not configured for this build.");
    return this.serialize(async () => {
      try {
        return this.computeStatus(await this.store.read(), now);
      } catch (error) {
        if (!isUnreadableLicenseRecord(error)) throw error;
      }
      const fresh = await this.newRecord(now);
      await this.replaceUnreadable(fresh);
      return this.computeStatus(fresh, now);
    });
  }
}
