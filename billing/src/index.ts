import Stripe from "stripe";
import { checkout } from "./checkout.ts";
import { config, type Env } from "./config.ts";
import { error } from "./http.ts";
import { licenses } from "./licenses.ts";
import { webhook } from "./webhook.ts";

export type StripeFactory = (env: Env) => Stripe;
export function createWorker(
  stripeFactory: StripeFactory = (env) =>
    new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    }),
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      let cfg;
      try {
        cfg = config(env);
      } catch {
        return error(503, "service_unconfigured");
      }
      const url = new URL(request.url);
      if (url.origin !== cfg.origin) return error(403, "origin_mismatch");
      const path = url.pathname;
      try {
        if (path === "/v1/stripe/webhook")
          return await webhook(request, env, cfg, stripeFactory(env));
        if (path.startsWith("/v1/licenses/")) return await licenses(request, env, cfg);
        if (
          [
            "/buy",
            "/receipt",
            "/buy.js",
            "/receipt.js",
            "/v1/checkout",
            "/v1/checkout/status",
            "/v1/checkout/claim",
          ].includes(path)
        )
          return await checkout(request, env, cfg, stripeFactory(env));
        return error(404, "not_found");
      } catch {
        return error(503, "service_unavailable");
      }
    },
  };
}
export default createWorker();
