// These public IDs are supplied by the build. They are not merchant API credentials.
export const DAYBOARD_LEMONSQUEEZY_STORE_ID = process.env.DAYBOARD_LEMONSQUEEZY_STORE_ID ?? "";
export const DAYBOARD_LEMONSQUEEZY_PRODUCT_ID = process.env.DAYBOARD_LEMONSQUEEZY_PRODUCT_ID ?? "";
/** Comma-separated allowed variant IDs, to support multiple licensed price plans. */
export const DAYBOARD_LEMONSQUEEZY_VARIANT_ID = process.env.DAYBOARD_LEMONSQUEEZY_VARIANT_ID ?? "";
export const DAYBOARD_LEMONSQUEEZY_CHECKOUT_URL =
  process.env.DAYBOARD_LEMONSQUEEZY_CHECKOUT_URL ?? "";

export interface LicenseProductConfig {
  storeId: string;
  productId: string;
  variantIds: readonly string[];
}

export function configuredLicenseProduct(): LicenseProductConfig | null {
  const storeId = DAYBOARD_LEMONSQUEEZY_STORE_ID.trim();
  const productId = DAYBOARD_LEMONSQUEEZY_PRODUCT_ID.trim();
  const variantIds = DAYBOARD_LEMONSQUEEZY_VARIANT_ID.split(",").map((id) => id.trim());
  const validId = (id: string) => /^[1-9]\d*$/.test(id);
  if (
    !validId(storeId) ||
    !validId(productId) ||
    !variantIds.length ||
    !variantIds.every(validId)
  ) {
    return null;
  }
  return { storeId, productId, variantIds };
}

export const TRIAL_DAYS = 14;
export const REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_GRACE_DAYS = 30;

/**
 * Set DAYBOARD_LICENSE=off at build time to ship a self-built GPL-3.0 copy with licensing
 * gating disabled entirely (trial/expired/invalid/network-error never block anything). Needs
 * documenting in AGENTS.md's build commands — out of this file's ownership, see HANDOFF.md.
 */
export function isLicenseGatingDisabled(): boolean {
  return process.env.DAYBOARD_LICENSE === "off";
}
