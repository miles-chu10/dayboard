// Public entry point for licensing. Handlers call the functions below instead of touching
// LicenseService/DayBoardLicenseVerifier/FileLicenseStore directly. The Electron-backed store is
// loaded lazily (see license-store.ts) so importing this module stays side-effect-free for tests.

import {
  ACTIVATION_LIMIT,
  OFFLINE_GRACE_DAYS,
  REVALIDATE_INTERVAL_MS,
  TRIAL_DAYS,
  configuredLicenseProduct,
  isLicenseGatingDisabled,
} from "./config.js";
import { isDemoMode } from "../demo-data.js";
import { DayBoardLicenseVerifier } from "./dayboard-verifier.js";
import { createInstallationIdSource } from "./installation-id.js";
import { LicenseService } from "./license-service.js";
import { createLicenseOperations } from "./license-operations.js";

export type {
  LicenseDeactivationPayload,
  LicenseStatus,
  LicenseStatusPayload,
} from "../../../shared/license.js";
export { isLicenseBlocking } from "./license-service.js";

let servicePromise: Promise<LicenseService> | undefined;
const changeListeners = new Set<() => void>();

/** Called when the service changes license data on its own, e.g. a background release confirms. */
export function onLicenseChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notifyChange(): void {
  for (const listener of changeListeners) listener();
}

function getService(): Promise<LicenseService> {
  const product = configuredLicenseProduct();
  if (!product) throw new Error("License activation is not configured for this build.");
  servicePromise ??= import("./license-store.js").then(({ createDefaultLicenseStore }) => {
    // One source for the store's migration and the service, so ioreg runs at most once.
    const installationId = createInstallationIdSource();
    return new LicenseService(
      new DayBoardLicenseVerifier(product.apiUrl),
      createDefaultLicenseStore({ installationId }),
      {
        trialDays: TRIAL_DAYS,
        revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
        offlineGraceDays: OFFLINE_GRACE_DAYS,
        activationLimit: ACTIVATION_LIMIT,
        installationId,
        onReleasesSettled: notifyChange,
        product,
      },
    );
  });
  return servicePromise;
}

const operations = createLicenseOperations({
  mode: () =>
    isDemoMode()
      ? "demo"
      : isLicenseGatingDisabled()
        ? "disabled"
        : configuredLicenseProduct()
          ? "configured"
          : "unconfigured",
  getService,
  checkoutUrl: configuredLicenseProduct()?.apiUrl.concat("/buy") ?? "",
});

export const getLicenseStatus = operations.getStatus;
export const refreshLicenseStatus = operations.refresh;
export const activateLicense = operations.activate;
export const deactivateLicense = operations.deactivate;
export const forgetPendingLicenseReleases = operations.forgetPendingReleases;
export const resetUnreadableLicense = operations.resetUnreadable;
export const assertLicenseAccess = operations.assertLicenseAccess;
