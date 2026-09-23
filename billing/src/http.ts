import type { Env, Config } from "./config.ts";
import { hash } from "./crypto.ts";

export const securityHeaders: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function error(status: number, code: string): Response {
  return json({ error: code }, status);
}
export function sameOrigin(request: Request, cfg: Config): boolean {
  return (
    request.headers.get("Origin") === cfg.origin &&
    !["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site") ?? "")
  );
}
export function bodyIsJson(request: Request, maxBytes = 2048): boolean {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  return (
    request.headers.get("Content-Type")?.split(";")[0] === "application/json" &&
    Number.isFinite(length) &&
    length <= maxBytes
  );
}
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function readJson(request: Request, maxBytes = 2048): Promise<unknown> {
  if (!bodyIsJson(request, maxBytes)) throw new Error("invalid_body");
  return JSON.parse(await readBoundedText(request, maxBytes));
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function limit(
  request: Request,
  env: Env,
  route: string,
  threshold: number,
): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = await hash(`${route}:${ip}`, env.HASH_SECRET);
  const windowStart = Math.floor(Date.now() / 60000);
  const row =
    await env.DB.prepare(`INSERT INTO rate_limits (bucket,window_start,hits) VALUES (?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,
    hits=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.hits+1 ELSE 1 END
    RETURNING hits`)
      .bind(bucket, windowStart)
      .first<{ hits: number }>();
  return (row?.hits ?? 9999) <= threshold;
}
