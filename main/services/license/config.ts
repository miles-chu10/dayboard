import { parseDesktopLicenseConfig } from "../../../shared/license-config.js";

export const TRIAL_DAYS = 14;
export const REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_GRACE_DAYS = 30;

/** Public build inputs. Merchant secrets stay on the license service. */
export function configuredLicenseProduct() {
  return parseDesktopLicenseConfig({
    apiUrl: process.env.DAYBOARD_LICENSE_API_URL ?? "",
    productId: process.env.DAYBOARD_STRIPE_PRODUCT_ID ?? "",
    environment: process.env.DAYBOARD_LICENSE_ENVIRONMENT ?? "",
  });
}

export function isLicenseGatingDisabled(): boolean {
  return process.env.DAYBOARD_LICENSE === "off";
}
