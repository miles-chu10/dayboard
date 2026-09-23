let activeWrites = 0;
let accountChangePending = false;
const waiters = new Set<() => void>();

/** Account replacement and provider writes must never enter concurrently. */
export async function trackAccountChange(operation: () => Promise<unknown>): Promise<void> {
  if (accountChangePending || activeWrites > 0)
    throw new Error("Wait for the current save or account connection to finish, then try again.");
  accountChangePending = true;
  try {
    await operation();
  } finally {
    accountChangePending = false;
    for (const resolve of waiters) resolve();
    waiters.clear();
  }
}

/**
 * Tracks provider writes that must finish before DayBoard starts a normal quit.
 * Starting the operation from a promise callback also guarantees synchronous
 * validation errors release the tracker.
 */
export function trackPendingWrite<T>(operation: () => Promise<T>): Promise<T> {
  if (accountChangePending)
    return Promise.reject(new Error("Wait for the account connection to finish, then try again."));
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
  return activeWrites > 0 || accountChangePending;
}

/** Waits until every write already in progress has settled. */
export async function drainPendingWrites(): Promise<void> {
  while (hasPendingWrites()) {
    await new Promise<void>((resolve) => waiters.add(resolve));
  }
}
