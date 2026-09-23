import type {
  ActivateResult,
  DeactivateResult,
  LicenseBinding,
  LicenseInfo,
  LicenseVerifier,
  ValidateResult,
} from "../../../shared/license-contract.js";

const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function binding(value: unknown): value is LicenseBinding {
  return (
    object(value) &&
    typeof value.issuer === "string" &&
    /^https:\/\/[^/]+$/.test(value.issuer) &&
    typeof value.productId === "string" &&
    /^prod_[A-Za-z0-9]+$/.test(value.productId) &&
    (value.environment === "test" || value.environment === "live")
  );
}

function license(value: unknown): value is LicenseInfo {
  return (
    object(value) &&
    (value.status === "active" || value.status === "inactive" || value.status === "revoked") &&
    (value.expiresAt === null ||
      (typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt))))
  );
}

function malformed(): never {
  throw new Error("The DayBoard license service returned an invalid response.");
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  try {
    void body?.cancel().catch(() => undefined);
  } catch {
    // A rejected response is already unusable; cleanup must not mask its transient error.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // The request is also aborted by the caller.
  }
}

async function readLimited(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers?.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) malformed();
  if (!response.body) malformed();
  const reader = response.body.getReader();
  const onAbort = () => cancelReader(reader);
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) malformed();
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) malformed();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        cancelReader(reader);
        malformed();
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return malformed();
  }
}

/** Only complete, explicit domain failures are authoritative; everything else is transient. */
function parseResult(
  path: "activate" | "validate" | "deactivate",
  status: number,
  body: unknown,
  expectedInstanceId?: string,
): ActivateResult | ValidateResult | DeactivateResult {
  if (!object(body)) malformed();
  const flag = path === "activate" ? "activated" : path === "validate" ? "valid" : "deactivated";
  if (typeof body[flag] !== "boolean") malformed();
  if (body[flag] === false) {
    if (
      ![200, 400, 404, 422].includes(status) ||
      typeof body.error !== "string" ||
      !body.error.trim()
    )
      malformed();
    // Remote error text is untrusted and may echo a license key or response body.
    return { [flag]: false, error: "The license was not accepted." } as unknown as ActivateResult;
  }
  if (status !== 200) malformed();
  if (path === "deactivate") return { deactivated: true };
  if (!license(body.license) || !binding(body.meta)) malformed();
  if (path === "activate") {
    if (body.created !== true && body.created !== false) malformed();
    if (typeof body.instanceId !== "string" || !body.instanceId.trim()) malformed();
    return {
      activated: true,
      created: body.created,
      instanceId: body.instanceId,
      license: body.license,
      meta: body.meta,
    };
  }
  if (expectedInstanceId && (typeof body.instanceId !== "string" || !body.instanceId.trim()))
    malformed();
  return {
    valid: true,
    instanceId: typeof body.instanceId === "string" ? body.instanceId : undefined,
    license: body.license,
    meta: body.meta,
  };
}

export class DayBoardLicenseVerifier implements LicenseVerifier {
  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:" || url.origin !== apiUrl)
      throw new Error("Invalid license service URL.");
  }

  private async post(
    path: "activate" | "validate" | "deactivate",
    body: object,
    expectedInstanceId?: string,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | undefined;
    let bodyConsumed = false;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/v1/licenses/${path}`, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (
        response.type === "opaqueredirect" ||
        response.redirected ||
        response.status === 429 ||
        response.status >= 500 ||
        (response.status >= 300 && response.status < 400) ||
        ![200, 400, 404, 422].includes(response.status)
      ) {
        throw new Error("The DayBoard license service is temporarily unavailable.");
      }
      const contentType = response.headers?.get("content-type");
      if (!contentType?.toLowerCase().startsWith("application/json")) malformed();
      const parsed = await readLimited(response, controller.signal);
      bodyConsumed = true;
      return parseResult(path, response.status, parsed, expectedInstanceId);
    } catch {
      // Never propagate fetch errors, URLs, server bodies or echoed key material.
      throw new Error(
        "The DayBoard license service is temporarily unavailable or returned an invalid response.",
      );
    } finally {
      if (response && !bodyConsumed) cancelBody(response.body);
      controller.abort();
      clearTimeout(timeout);
    }
  }

  activate(
    licenseKey: string,
    installationId: string,
    instanceName: string,
  ): Promise<ActivateResult> {
    return this.post("activate", {
      licenseKey,
      installationId,
      instanceName,
    }) as Promise<ActivateResult>;
  }
  validate(licenseKey: string, instanceId?: string): Promise<ValidateResult> {
    return this.post(
      "validate",
      { licenseKey, ...(instanceId ? { instanceId } : {}) },
      instanceId,
    ) as Promise<ValidateResult>;
  }
  deactivate(licenseKey: string, instanceId: string): Promise<DeactivateResult> {
    return this.post("deactivate", { licenseKey, instanceId }) as Promise<DeactivateResult>;
  }
}
