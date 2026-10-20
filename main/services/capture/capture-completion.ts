const CAPTURE_TIMEOUT_MS = 3 * 60_000;

/** Capture has no Stop button after its panel hides, so bound setup and generation together. */
export async function completeCapture(
  run: (signal: AbortSignal) => Promise<{ text: string }>,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Quick Capture timed out. Check the details, then add it manually.");
      // Reject first: a provider that resolves on abort must not turn the timeout into success.
      reject(error);
      controller.abort(error);
    }, CAPTURE_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([run(controller.signal), deadline])).text;
  } finally {
    clearTimeout(timer);
  }
}
