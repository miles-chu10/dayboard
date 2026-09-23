export interface Env {
  DB: D1Database;
  SERVICE_ORIGIN: string;
  PRODUCT_ID: string;
  PRICE_ID: string;
  PRICE_CURRENCY: string;
  ENVIRONMENT: string;
  ACTIVATION_LIMIT: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ENCRYPTION_KEY: string;
  HASH_SECRET: string;
}

export interface Config {
  origin: string;
  productId: string;
  priceId: string;
  currency: string;
  environment: "test" | "live";
  activationLimit: number;
}

export function config(env: Env): Config {
  const origin = new URL(env.SERVICE_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.SERVICE_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error("SERVICE_ORIGIN must be an HTTPS origin");
  if (!/^prod_[A-Za-z0-9]+$/.test(env.PRODUCT_ID) || !/^price_[A-Za-z0-9]+$/.test(env.PRICE_ID))
    throw new Error("product and price IDs required");
  if (!/^[a-z]{3}$/.test(env.PRICE_CURRENCY)) throw new Error("currency required");
  if (env.ENVIRONMENT !== "test" && env.ENVIRONMENT !== "live")
    throw new Error("environment required");
  if (!/^[1-9][0-9]?$/.test(env.ACTIVATION_LIMIT)) throw new Error("activation limit required");
  if (
    !new RegExp(`^(sk|rk)_${env.ENVIRONMENT}_`).test(env.STRIPE_SECRET_KEY ?? "") ||
    !env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")
  )
    throw new Error("Stripe secrets and mode must match");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(env.ENCRYPTION_KEY) ||
    !env.HASH_SECRET ||
    env.HASH_SECRET.length < 32 ||
    !env.DB
  )
    throw new Error("database or crypto secrets missing");
  return {
    origin: origin.origin,
    productId: env.PRODUCT_ID,
    priceId: env.PRICE_ID,
    currency: env.PRICE_CURRENCY,
    environment: env.ENVIRONMENT,
    activationLimit: Number(env.ACTIVATION_LIMIT),
  };
}
