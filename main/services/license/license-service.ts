// Pure license state machine: AI trial countdown (starts on first paid-feature use), revalidate-at-most-daily, 30-day offline grace,
// invalid-key detection, unconfirmed slot releases (retried in the background), reactivation of
// a slot another account on this Mac released, and unreadable-record recovery. No Electron
// imports, so tests/license-service.test.mjs can esbuild-bundle and unit-test it with an
// in-memory store and a mocked verifier.

import type { LicenseRelease, LicenseStatus } from "../../../shared/license.js";
import { LICENSE_INSTANCE_NAME, LICENSE_SUPPORT_EMAIL } from "../../../shared/license.js";
import { randomUUID } from "node:crypto";
import { INSTALLATION_ID_PATTERN, LICENSE_KEY_PATTERN } from "../../../shared/license-contract.js";
import type {
  ActivateResult,
  LicenseBinding,
  LicenseInfo,
  LicenseVerifier,
  ValidateResult,
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
  /**
   * Moves the unreadable saved file to a timestamped backup and saves nothing, so `read` finds no
   * record. Needed only by stores whose `read` can throw `UnreadableLicenseRecordError`.
   */
  setAsideUnreadable?(): Promise<void>;
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
  /** Called after a background retry confirms a release and saves it, so callers can push status. */
  onReleasesSettled?: () => void;
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
const NO_LONGER_VALID_MESSAGE = "This license key is no longer valid.";
const OTHER_PRODUCT_MESSAGE = "This license key is for another product or is no longer active.";
const RELEASED_MESSAGE = "This Mac's activation was released.";
const REACTIVATE_MESSAGE = `${RELEASED_MESSAGE} Enter your license key again to reactivate it.`;
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
  /** The network phase of a background release retry; never rejects and never takes the lock. */
  private releaseRequests: Promise<unknown> | null = null;
  /** Every background retry, including saving its result. */
  private backgroundReleases: Promise<void> = Promise.resolve();

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

  /** Pending releases this build's service can confirm. Others wait for a build bound to theirs. */
  private ownReleases(record: LicenseRecord): PendingRelease[] {
    return (record.pendingReleases ?? []).filter((item) =>
      matchesProduct(item.binding, this.options.product!),
    );
  }

  /** Adds a release; past the cap, items another build must release are dropped first. */
  private withRelease(pending: PendingRelease[], release: PendingRelease): PendingRelease[] {
    const kept = [...pending.filter((item) => item.instanceId !== release.instanceId), release];
    while (kept.length > MAX_PENDING_RELEASES) {
      const foreign = kept.findIndex(
        (item) => !matchesProduct(item.binding, this.options.product!),
      );
      kept.splice(foreign >= 0 ? foreign : 0, 1);
    }
    return kept;
  }

  /**
   * Any complete answer settles a release: the service freed the slot, or it holds none for this
   * key (revoked, or an unknown key or instance). Only an unreachable service leaves it pending.
   */
  private async release({
    licenseKey,
    instanceId,
  }: Pick<PendingRelease, "licenseKey" | "instanceId">): Promise<boolean> {
    try {
      await this.verifier.deactivate(licenseKey, instanceId);
      return true;
    } catch {
      return false;
    }
  }

  /** Sends the releases at once, so a slow service costs one request timeout, not one per item. */
  private async confirmReleases(items: PendingRelease[]): Promise<PendingRelease[]> {
    const confirmed = await Promise.all(items.map((item) => this.release(item)));
    return items.filter((_, index) => confirmed[index]);
  }

  /** Retries this build's pending releases now and returns how many are still unconfirmed. */
  private async settleReleases(
    record: LicenseRecord,
  ): Promise<{ record: LicenseRecord; unconfirmed: number }> {
    const own = this.ownReleases(record);
    const confirmed = await this.confirmReleases(own);
    const unconfirmed = own.length - confirmed.length;
    if (!confirmed.length) return { record, unconfirmed };
    const next: LicenseRecord = {
      ...record,
      pendingReleases: (record.pendingReleases ?? []).filter((item) => !confirmed.includes(item)),
    };
    try {
      await this.store.write(next);
      return { record: next, unconfirmed };
    } catch {
      // The service already confirmed; releasing the same instance again later is harmless.
      return { record, unconfirmed };
    }
  }

  /**
   * Retries unconfirmed releases without holding the service lock, so the refresh before an AI
   * action or capture never waits on the license service. Only saving the result takes the lock.
   */
  private retryReleasesInBackground(record: LicenseRecord, now: Date): void {
    const items = this.ownReleases(record);
    if (!items.length || this.releaseRequests || now.getTime() < this.nextReleaseRetryAt) return;
    const requests = this.confirmReleases(items);
    this.releaseRequests = requests;
    const settled = requests.then(async (confirmed) => {
      this.releaseRequests = null;
      this.nextReleaseRetryAt =
        confirmed.length < items.length ? now.getTime() + RELEASE_RETRY_MS : 0;
      if (confirmed.length && (await this.serialize(() => this.dropConfirmed(confirmed))))
        this.options.onReleasesSettled?.();
    });
    this.backgroundReleases = Promise.all([this.backgroundReleases, settled]).then(
      () => undefined,
      () => undefined,
    );
  }

  /** Removes confirmed releases from the record as it is now; false when nothing changed. */
  private async dropConfirmed(confirmed: PendingRelease[]): Promise<boolean> {
    const record = await this.store.read();
    const pending = record?.pendingReleases ?? [];
    const remaining = pending.filter(
      (item) =>
        !confirmed.some(
          (done) => done.instanceId === item.instanceId && done.licenseKey === item.licenseKey,
        ),
    );
    if (!record || remaining.length === pending.length) return false;
    await this.store.write({ ...record, pendingReleases: remaining });
    return true;
  }

  /** Resolves once background release retries have finished and saved what they confirmed. */
  whenReleasesSettled(): Promise<void> {
    return this.backgroundReleases;
  }

  /** Records the service's rejection of the saved key, with the reason shown in Settings. */
  private async saveRejection(
    record: LicenseRecord,
    now: Date,
    message: string,
  ): Promise<LicenseStatus> {
    const next: LicenseRecord = {
      ...record,
      lastValidationAt: now.toISOString(),
      lastValidationValid: false,
      lastValidationMessage: message,
      productBinding: null,
    };
    await this.store.write(next);
    return this.computeStatus(next, now);
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
        message: record.lastValidationMessage ?? NO_LONGER_VALID_MESSAGE,
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

  /**
   * Whether a key this Mac stopped using is still kept because this build's service hasn't
   * confirmed its release. False when the record can't be read.
   */
  async hasPendingRelease(): Promise<boolean> {
    if (this.options.gatingDisabled || !this.options.product) return false;
    return this.serialize(async () => {
      try {
        const record = await this.store.read();
        return record ? this.ownReleases(record).length > 0 : false;
      } catch {
        return false;
      }
    });
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
   * releases are retried in the background, at most once per `RELEASE_RETRY_MS` after a failure.
   */
  async refresh(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) return { state: "disabled" };
    if (!this.options.product) return { state: "unconfigured" };
    return this.serialize(() => this.unlessUnreadable(() => this.refreshLocked(now)));
  }

  private async refreshLocked(now: Date): Promise<LicenseStatus> {
    const record = await this.store.read();
    if (record) this.retryReleasesInBackground(record, now);
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
    if (!result.valid && result.error === "invalid_instance" && record.instanceId)
      return this.reactivate(record, record.licenseKey, now);
    if (result.valid && (!result.meta || !result.license || !result.instanceId)) {
      return this.computeStatus(record, now);
    }
    if (!result.valid && !result.error) return this.computeStatus(record, now);
    const valid =
      result.valid &&
      result.instanceId === record.instanceId &&
      matchesProduct(result.meta!, this.options.product!) &&
      isUsableLicense(result.license!, now);
    if (!valid)
      return this.saveRejection(
        record,
        now,
        result.valid
          ? OTHER_PRODUCT_MESSAGE
          : result.error === "revoked"
            ? REVOKED_MESSAGE
            : NO_LONGER_VALID_MESSAGE,
      );
    const next: LicenseRecord = {
      ...record,
      lastValidationAt: now.toISOString(),
      lastValidationValid: true,
      lastValidationMessage: null,
      productBinding: result.meta!,
    };
    await this.store.write(next);
    return this.computeStatus(next, now);
  }

  /**
   * Every macOS account on this Mac shares its installation ID, so another account's Deactivate,
   * key switch or release retry also frees this one's activation. If the key itself is still good,
   * ask for this Mac's slot again with the same installation ID, which reuses the slot when one
   * exists. A service that can't be reached leaves the record unchanged.
   */
  private async reactivate(
    record: LicenseRecord,
    licenseKey: string,
    now: Date,
  ): Promise<LicenseStatus> {
    let preflight: ValidateResult;
    try {
      preflight = await this.verifier.validate(licenseKey);
    } catch {
      return this.computeStatus(record, now);
    }
    if (!preflight.valid) {
      if (!preflight.error) return this.computeStatus(record, now);
      return this.saveRejection(
        record,
        now,
        preflight.error === "revoked" ? REVOKED_MESSAGE : NO_LONGER_VALID_MESSAGE,
      );
    }
    if (!preflight.meta || !preflight.license) return this.computeStatus(record, now);
    if (
      !matchesProduct(preflight.meta, this.options.product!) ||
      !isActivatableLicense(preflight.license, now)
    )
      return this.saveRejection(record, now, OTHER_PRODUCT_MESSAGE);

    await this.releaseRequests;
    let activation: ActivateResult;
    try {
      activation = await this.verifier.activate(
        licenseKey,
        record.installationId,
        record.instanceName ?? LICENSE_INSTANCE_NAME,
      );
    } catch {
      return this.computeStatus(record, now);
    }
    if (!activation.activated) {
      if (!activation.error) return this.computeStatus(record, now);
      return this.saveRejection(
        record,
        now,
        activation.error === "revoked"
          ? REVOKED_MESSAGE
          : activation.error === "activation_limit"
            ? `${RELEASED_MESSAGE} ${activationLimitMessage(this.options.activationLimit)}`
            : REACTIVATE_MESSAGE,
      );
    }
    const instanceId = activation.instanceId;
    if (typeof instanceId !== "string" || !instanceId.trim())
      return this.computeStatus(record, now);
    if (
      !activation.meta ||
      !activation.license ||
      !matchesProduct(activation.meta, this.options.product!) ||
      !isUsableLicense(activation.license, now)
    ) {
      if (activation.created === true) await this.release({ licenseKey, instanceId });
      return this.saveRejection(record, now, REACTIVATE_MESSAGE);
    }
    const next: LicenseRecord = {
      ...record,
      instanceId,
      lastValidationAt: now.toISOString(),
      lastValidationValid: true,
      lastValidationMessage: null,
      productBinding: activation.meta,
      pendingReleases: (record.pendingReleases ?? []).filter(
        (item) => item.instanceId !== instanceId,
      ),
    };
    try {
      await this.store.write(next);
    } catch (error) {
      if (activation.created === true) await this.release({ licenseKey, instanceId });
      throw error;
    }
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

    // A release still in flight could otherwise free the very activation this request reuses.
    await this.releaseRequests;
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
      pendingReleases = this.withRelease(pendingReleases, previous);
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
    const settled = this.ownReleases(next).length ? (await this.settleReleases(next)).record : next;
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
   * free, or that nothing here could be released; also used to retry unconfirmed releases.
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
      pendingReleases: current ? this.withRelease(pending, current) : pending,
    };
    await this.store.write(next);
    if (!this.ownReleases(next).length)
      return { status: this.computeStatus(next, now), release: "none" };
    const settled = await this.settleReleases(next);
    this.nextReleaseRetryAt = settled.unconfirmed ? now.getTime() + RELEASE_RETRY_MS : 0;
    return {
      status: this.computeStatus(settled.record, now),
      release: settled.unconfirmed ? "pending" : "released",
    };
  }

  /**
   * Drops every unconfirmed release, and with it the last copy of those keys on this Mac, without
   * telling the service. Their slots may stay in use until support frees them.
   */
  async forgetPendingReleases(now = new Date()): Promise<LicenseStatus> {
    if (this.options.gatingDisabled) throw new Error("License data is disabled for this build.");
    if (!this.options.product) throw new Error("License data is not configured for this build.");
    return this.serialize(async () => {
      let record: LicenseRecord | null;
      try {
        record = await this.store.read();
      } catch (error) {
        if (isUnreadableLicenseRecord(error)) throw new Error(UNREADABLE_MESSAGE);
        throw error;
      }
      if (record?.pendingReleases?.length) {
        record = { ...record, pendingReleases: [] };
        await this.store.write(record);
      }
      this.nextReleaseRetryAt = 0;
      return this.computeStatus(record, now);
    });
  }

  /**
   * Recovery for a license file that can't be decrypted or parsed: moves it to a backup and saves
   * nothing, so the AI trial starts on the next AI use as on a new Mac, and this Mac's
   * installation ID is derived again then. A readable record is left untouched.
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
      if (!this.store.setAsideUnreadable) throw new Error(UNREADABLE_MESSAGE);
      await this.store.setAsideUnreadable();
      return this.unlessUnreadable(async () => this.computeStatus(await this.store.read(), now));
    });
  }
}
