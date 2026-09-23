import type { LicenseBinding } from "./license-contract.js";

export interface DesktopLicenseConfig extends LicenseBinding {
  apiUrl: string;
}

/** Public build inputs only. A build without a complete HTTPS service binding is a preview. */
export function parseDesktopLicenseConfig(input: {
  apiUrl: string;
  productId: string;
  environment: string;
}): DesktopLicenseConfig | null {
  try {
    const url = new URL(input.apiUrl.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "") ||
      !/^prod_[A-Za-z0-9]+$/.test(input.productId.trim()) ||
      (input.environment !== "test" && input.environment !== "live")
    )
      return null;
    return {
      apiUrl: url.origin,
      issuer: url.origin,
      productId: input.productId.trim(),
      environment: input.environment,
    };
  } catch {
    return null;
  }
}
