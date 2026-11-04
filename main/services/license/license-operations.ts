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

  function payload(status: LicenseStatus): LicenseStatusPayload {
    return { status, checkoutUrl: deps.checkoutUrl };
  }

  function requireConfigured(action: string): void {
    const mode = deps.mode();
    if (mode !== "configured") throw new Error(`License ${action} is unavailable in ${mode} mode.`);
  }

  async function getStatus(): Promise<LicenseStatusPayload> {
    return immediateStatus() ?? payload(await (await deps.getService()).getStatus());
  }

  async function refresh(): Promise<LicenseStatusPayload> {
    return immediateStatus() ?? payload(await (await deps.getService()).refresh());
  }

  async function activate(licenseKey: string, instanceName: string): Promise<LicenseStatusPayload> {
    requireConfigured("activation");
    return payload(await (await deps.getService()).activate(licenseKey, instanceName));
  }

  async function deactivate(): Promise<LicenseDeactivationPayload> {
    requireConfigured("deactivation");
    const { status, release } = await (await deps.getService()).deactivate();
    return { ...payload(status), release };
  }

  /** Recovery for an unreadable license file; a readable one is left as is. */
  async function resetUnreadable(): Promise<LicenseStatusPayload> {
    requireConfigured("reset");
    return payload(await (await deps.getService()).resetUnreadable());
  }

  async function assertLicenseAccess(): Promise<void> {
    if (deps.mode() === "configured") await (await deps.getService()).startTrial();
    const { status } = await refresh();
    if (isLicenseBlocking(status)) throw new LicenseRequiredError(status.state);
  }

  return { getStatus, refresh, activate, deactivate, resetUnreadable, assertLicenseAccess };
}
