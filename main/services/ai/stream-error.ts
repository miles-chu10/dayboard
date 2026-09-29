/** JSON when the object serializes (a circular structure does not), else its string form. */
function describe(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    try {
      const json = JSON.stringify(value);
      if (json !== undefined) return json;
    } catch {
      // Circular or otherwise unserializable: fall through to the plain string form.
    }
  }
  return String(value);
}

/**
 * A provider error that arrives after output started is a plain object, not an Error, so its
 * message would be lost as "[object Object]". An Error stays as is; anything else keeps its
 * message, or is described when it has none.
 */
export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return new Error(String(message ?? describe(error)));
}
