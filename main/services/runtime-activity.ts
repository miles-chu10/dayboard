type DrainWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

let paused = false;
let active = 0;
const drainWaiters = new Set<DrainWaiter>();

/** Register work before invoking it, so a concurrent pause cannot miss the operation. */
export function runAppOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  if (paused) return Promise.reject(new Error("DayBoard is preparing to install an update."));
  active++;
  let result: Promise<T>;
  try {
    result = Promise.resolve(operation());
  } catch (error) {
    result = Promise.reject(error);
  }
  return result.finally(() => {
    active--;
    if (active === 0) {
      for (const waiter of drainWaiters) waiter.resolve();
      drainWaiters.clear();
    }
  });
}

/** Keep the gate closed after a successful drain, until install failure or process exit. */
export async function pauseAndDrainAppOperations(timeoutMs = 10_000): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Update drain timeout must be positive.");
  paused = true;
  if (active === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: DrainWaiter | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        waiter = { resolve, reject };
        drainWaiters.add(waiter);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("DayBoard operations are still in progress.")),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    resumeAppOperations();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (waiter) drainWaiters.delete(waiter);
  }
}

/** Called only when installation cannot proceed, restoring normal app use. */
export function resumeAppOperations(): void {
  paused = false;
  for (const waiter of drainWaiters) waiter.reject(new Error("Update installation was cancelled."));
  drainWaiters.clear();
}
