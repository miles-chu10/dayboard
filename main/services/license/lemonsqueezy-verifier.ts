// LicenseVerifier implementation against Lemon Squeezy's public License API
// (https://docs.lemonsqueezy.com/api/license-api — read for the request/response
// shapes only; no SDK or Glaze source was copied). Endpoints take form-encoded `license_key` +
// `instance_name`/`instance_id` and need no secret, so this can run entirely in the Electron main
// process. `fetchImpl` is injectable so tests never make a real network call (see
// tests/license-verifier.test.mjs).

export interface LemonSqueezyLicenseInfo {
  status?: string;
  expiresAt: string | null;
}

export interface LemonSqueezyLicenseMeta {
  storeId: string;
  productId: string;
  variantId: string;
}

export interface ActivateResult {
  activated: boolean;
  error?: string;
  instanceId?: string;
  license?: LemonSqueezyLicenseInfo;
  meta?: LemonSqueezyLicenseMeta;
}

export interface ValidateResult {
  valid: boolean;
  error?: string;
  license?: LemonSqueezyLicenseInfo;
  meta?: LemonSqueezyLicenseMeta;
  instanceId?: string;
}

export interface DeactivateResult {
  deactivated: boolean;
  error?: string;
}

export interface LicenseVerifier {
  activate(licenseKey: string, instanceName: string): Promise<ActivateResult>;
  validate(licenseKey: string, instanceId?: string): Promise<ValidateResult>;
  deactivate(licenseKey: string, instanceId: string): Promise<DeactivateResult>;
}

const DEFAULT_BASE_URL = "https://api.lemonsqueezy.com/v1/licenses";

interface RawLicenseKey {
  status?: string;
  expires_at?: string | null;
}

interface RawResponseBody {
  activated?: boolean;
  valid?: boolean;
  deactivated?: boolean;
  error?: string | null;
  instance?: { id?: string };
  license_key?: RawLicenseKey;
  meta?: { store_id?: number | string; product_id?: number | string; variant_id?: number | string };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMeta(raw: RawResponseBody["meta"]): LemonSqueezyLicenseMeta | undefined {
  const id = (value: unknown): string | null => {
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      !/^[1-9]\d*$/.test(String(value))
    ) {
      return null;
    }
    return String(value);
  };
  const storeId = id(raw?.store_id);
  const productId = id(raw?.product_id);
  const variantId = id(raw?.variant_id);
  if (!storeId || !productId || !variantId) return undefined;
  return {
    storeId,
    productId,
    variantId,
  };
}

function toLicenseInfo(raw: RawLicenseKey | undefined): LemonSqueezyLicenseInfo | undefined {
  if (!raw) return undefined;
  return { status: raw.status, expiresAt: raw.expires_at ?? null };
}

/**
 * Posts to `${baseUrl}/${path}` and returns the parsed JSON body. Throws when the network is
 * unreachable or the response isn't JSON — callers (LicenseService) treat that as a transient
 * network error, distinct from a well-formed "invalid key" response from the server.
 */
async function post(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<RawResponseBody> {
  const body = new URLSearchParams(params);
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetchImpl(`${baseUrl}/${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(
      `Couldn't reach Lemon Squeezy to ${path} this license: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    if (
      response.status === 429 ||
      response.status >= 500 ||
      response.status < 200 ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new Error(`Lemon Squeezy is temporarily unavailable (HTTP ${response.status}).`);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error(`Lemon Squeezy returned an unexpected response (HTTP ${response.status}).`);
    }
    if (!isObject(parsed)) throw new Error("Lemon Squeezy returned a malformed response.");
    const result = parsed as RawResponseBody;
    const flag =
      path === "activate"
        ? result.activated
        : path === "validate"
          ? result.valid
          : result.deactivated;
    if (typeof flag !== "boolean") throw new Error("Lemon Squeezy returned a malformed response.");
    if (flag) {
      if (response.status >= 300) {
        throw new Error("Lemon Squeezy returned a malformed response.");
      }
      // An activation may already have consumed a slot. Return even an incomplete positive
      // response so the service can release any instance ID the server supplied.
      if (
        path === "validate" &&
        (!isObject(result.license_key) ||
          !isObject(result.meta) ||
          (params.instance_id &&
            (!isObject(result.instance) ||
              typeof result.instance.id !== "string" ||
              !result.instance.id.trim())) ||
          typeof result.license_key?.status !== "string" ||
          (result.license_key.expires_at !== null &&
            (typeof result.license_key.expires_at !== "string" ||
              !Number.isFinite(Date.parse(result.license_key.expires_at)))) ||
          !toMeta(result.meta))
      ) {
        throw new Error("Lemon Squeezy returned a malformed response.");
      }
    } else if (
      typeof result.error !== "string" ||
      !result.error.trim() ||
      (response.status >= 400 && ![400, 404, 422].includes(response.status))
    ) {
      throw new Error("Lemon Squeezy returned a malformed response.");
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export class LemonSqueezyVerifier implements LicenseVerifier {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(deps?: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number }) {
    this.fetchImpl = deps?.fetchImpl ?? fetch;
    this.baseUrl = deps?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = deps?.timeoutMs ?? 10_000;
  }

  async activate(licenseKey: string, instanceName: string): Promise<ActivateResult> {
    const body = await post(
      this.fetchImpl,
      this.baseUrl,
      "activate",
      {
        license_key: licenseKey,
        instance_name: instanceName,
      },
      this.timeoutMs,
    );
    return {
      activated: body.activated === true,
      error: body.error ?? undefined,
      instanceId: body.instance?.id,
      license: toLicenseInfo(body.license_key),
      meta: toMeta(body.meta),
    };
  }

  async validate(licenseKey: string, instanceId?: string): Promise<ValidateResult> {
    const body = await post(
      this.fetchImpl,
      this.baseUrl,
      "validate",
      {
        license_key: licenseKey,
        ...(instanceId ? { instance_id: instanceId } : {}),
      },
      this.timeoutMs,
    );
    return {
      valid: body.valid === true,
      error: body.error ?? undefined,
      license: toLicenseInfo(body.license_key),
      meta: toMeta(body.meta),
      instanceId: body.instance?.id,
    };
  }

  async deactivate(licenseKey: string, instanceId: string): Promise<DeactivateResult> {
    const body = await post(
      this.fetchImpl,
      this.baseUrl,
      "deactivate",
      {
        license_key: licenseKey,
        instance_id: instanceId,
      },
      this.timeoutMs,
    );
    return {
      deactivated: body.deactivated === true,
      error: body.error ?? undefined,
    };
  }
}
