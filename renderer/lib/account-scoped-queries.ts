import type { QueryClient } from "@tanstack/react-query";

/** Caches that hold one account's private data beyond the source lists (meeting notes). */
const ACCOUNT_SCOPED_KEYS = [["meetings"]] as const;

/** On an account change: stop in-flight reads and forget their results, never show them later. */
export function clearAccountScopedQueries(queryClient: QueryClient): void {
  for (const queryKey of ACCOUNT_SCOPED_KEYS) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }
}
