import { LicenseRequiredError } from "../../../shared/license-policy.js";
import type {
  LicenseDeactivationPayload,
  LicenseStatus,
  LicenseStatusPayload,
} from "../../../shared/license.js";
import { isLicenseBlocking, type LicenseService } from "./license-service.js";

export type LicenseMode = "demo" | "disabled" | "unconfigured" | "configured";

/** Keeps preview and self-built modes out of the encrypted personal license store. */
export function createLicenseOperations(deps: {
  mode: () => LicenseMode;
  getService: () => Promise<LicenseService>;
  checkoutUrl: string;
}) {
  function immediateStatus(): LicenseStatusPayload | null {
    const mode = deps.mode();
    if (mode === "configured") return null;
    return { status: { state: mode }, checkoutUrl: "" };
  }

  async function payload(
    service: LicenseService,
    status: LicenseStatus,
  ): Promise<LicenseStatusPayload> {
    return {
      status,
      checkoutUrl: deps.checkoutUrl,
      releasePending: await service.hasPendingRelease(),
    };
  }

  function requireConfigured(action: string): void {
    const mode = deps.mode();
    if (mode !== "configured") throw new Error(`License ${action} is unavailable in ${mode} mode.`);
  }

  async function getStatus(): Promise<LicenseStatusPayload> {
    const immediate = immediateStatus();
    if (immediate) return immediate;
    const service = await deps.getService();
    return payload(service, await service.getStatus());
  }

  async function refresh(): Promise<LicenseStatusPayload> {
    const immediate = immediateStatus();
    if (immediate) return immediate;
    const service = await deps.getService();
    return payload(service, await service.refresh());
  }

  async function activate(licenseKey: string, instanceName: string): Promise<LicenseStatusPayload> {
    requireConfigured("activation");
    const service = await deps.getService();
    return payload(service, await service.activate(licenseKey, instanceName));
  }

  async function deactivate(): Promise<LicenseDeactivationPayload> {
    requireConfigured("deactivation");
    const service = await deps.getService();
    const { status, release } = await service.deactivate();
    return { ...(await payload(service, status)), release };
  }

  /** Deletes keys kept only for an unconfirmed release; their slots may stay in use. */
  async function forgetPendingReleases(): Promise<LicenseStatusPayload> {
    requireConfigured("data");
    const service = await deps.getService();
    return payload(service, await service.forgetPendingReleases());
  }

  /** Recovery for an unreadable license file; a readable one is left as is. */
  async function resetUnreadable(): Promise<LicenseStatusPayload> {
    requireConfigured("reset");
    const service = await deps.getService();
    return payload(service, await service.resetUnreadable());
  }

  /** Runs before every AI action and capture, so it reads only the status it needs. */
  async function assertLicenseAccess(): Promise<void> {
    let status = immediateStatus()?.status;
    if (!status) {
      const service = await deps.getService();
      await service.startTrial();
      status = await service.refresh();
    }
    if (isLicenseBlocking(status)) throw new LicenseRequiredError(status.state);
  }

  return {
    getStatus,
    refresh,
    activate,
    deactivate,
    forgetPendingReleases,
    resetUnreadable,
    assertLicenseAccess,
  };
}
