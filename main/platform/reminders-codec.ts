// Line-delimited JSON protocol shared with native/reminders-helper/main.swift. Pure (no Electron,
// no child_process) so the wire format can be unit-tested under plain `node --test`
// (see tests/platform-reminders-codec.test.mjs).

export interface HelperRequest {
  id: string;
  op: string;
  params: Record<string, unknown>;
}

export type HelperResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

/** One JSON line, newline-terminated, ready to write to the helper's stdin. */
export function encodeRequest(request: HelperRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function decodeResponse(line: string): HelperResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Reminders helper sent an invalid response line: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || !("id" in parsed) || !("ok" in parsed)) {
    throw new Error("Reminders helper response is missing required fields.");
  }
  const record = parsed as {
    id: unknown;
    ok: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (typeof record.id !== "string")
    throw new Error("Reminders helper response has a non-string id.");
  if (record.ok === true) return { id: record.id, ok: true, result: record.result };
  if (record.ok === false) {
    return {
      id: record.id,
      ok: false,
      error: typeof record.error === "string" ? record.error : "Unknown error",
    };
  }
  throw new Error("Reminders helper response has a non-boolean ok field.");
}

/**
 * Buffers raw stdout chunks and yields complete `\n`-terminated lines, holding back any trailing
 * partial line until more data arrives (a single JSON object can span multiple `data` events).
 */
export class LineBuffer {
  private pending = "";

  push(chunk: string): string[] {
    this.pending += chunk;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  }

  /** Whatever is left in the buffer when the stream ends without a trailing newline. */
  flush(): string[] {
    const rest = this.pending.trim();
    this.pending = "";
    return rest.length > 0 ? [rest] : [];
  }
}
