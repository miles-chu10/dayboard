/**
 * A provider error that arrives after output started is a plain object, not an Error, so its
 * message would be lost as "[object Object]". An Error stays as is.
 */
export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String((error as { message?: unknown } | null | undefined)?.message ?? error));
}
