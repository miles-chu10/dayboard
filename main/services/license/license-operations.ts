import type { LicenseStatus, LicenseStatusPayload } from "../../../shared/license.js";
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

  async function getStatus(): Promise<LicenseStatusPayload> {
    return immediateStatus() ?? payload(await (await deps.getService()).getStatus());
  }

  async function refresh(): Promise<LicenseStatusPayload> {
    return immediateStatus() ?? payload(await (await deps.getService()).refresh());
  }

  async function activate(licenseKey: string, instanceName: string): Promise<LicenseStatusPayload> {
    const mode = deps.mode();
    if (mode !== "configured")
      throw new Error(`License activation is unavailable in ${mode} mode.`);
    return payload(await (await deps.getService()).activate(licenseKey, instanceName));
  }

  async function deactivate(): Promise<LicenseStatusPayload> {
    const mode = deps.mode();
    if (mode !== "configured")
      throw new Error(`License deactivation is unavailable in ${mode} mode.`);
    return payload(await (await deps.getService()).deactivate());
  }

  async function assertLicenseAccess(): Promise<void> {
    const { status } = await refresh();
    if (isLicenseBlocking(status)) {
      throw new Error("License required for this action. Open Settings → License to continue.");
    }
  }

  return { getStatus, refresh, activate, deactivate, assertLicenseAccess };
}
