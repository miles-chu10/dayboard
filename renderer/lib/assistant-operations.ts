// Provider creation can outlive the Assistant route. A remounted conversation
// must wait for its confirmed result and history save before offering Add again.
const pending = new Set<Promise<unknown>>();

export function trackAssistantOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = Promise.resolve().then(operation);
  pending.add(result);
  void result.finally(() => pending.delete(result)).catch(() => undefined);
  return result;
}

export async function drainAssistantOperations(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
