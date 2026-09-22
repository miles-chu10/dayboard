let activeWrites = 0;
const waiters = new Set<() => void>();

/**
 * Tracks provider writes that must finish before DayBoard starts a normal quit.
 * Starting the operation from a promise callback also guarantees synchronous
 * validation errors release the tracker.
 */
export function trackPendingWrite<T>(operation: () => Promise<T>): Promise<T> {
  activeWrites += 1;
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      activeWrites -= 1;
      if (activeWrites !== 0) return;
      for (const resolve of waiters) resolve();
      waiters.clear();
    });
}

export function hasPendingWrites(): boolean {
  return activeWrites > 0;
}

/** Waits until every write already in progress has settled. */
export async function drainPendingWrites(): Promise<void> {
  while (activeWrites > 0) {
    await new Promise<void>((resolve) => waiters.add(resolve));
  }
}
