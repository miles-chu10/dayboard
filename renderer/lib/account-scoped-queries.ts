import type { QueryClient } from "@tanstack/query-core";

/** Caches that hold one account's private data beyond the source lists (meeting notes). */
const ACCOUNT_SCOPED_KEYS = [["meetings"]] as const;

/** On an account change: stop in-flight reads and forget their results, never show them later. */
export function clearAccountScopedQueries(queryClient: QueryClient): void {
  for (const queryKey of ACCOUNT_SCOPED_KEYS) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }
}

/** Refetch notes in every window, including Assistant snapshots, after a completed import. */
export async function refreshMeetingNotes(queryClient: QueryClient): Promise<void> {
  const queryKey = ["meetings"];
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
}
