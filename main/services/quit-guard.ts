interface QuitEvent {
  preventDefault(): void;
}

interface SaveQuitOptions {
  drain: () => Promise<void>;
  confirmUnfinished: () => Promise<boolean>;
  resumeQuit: () => void;
  isUpdateInstallReady?: () => boolean;
  onCancelled?: () => void;
  timeoutMs?: number;
}

/** Cancel native quit synchronously, then finish pending saves before requesting it again. */
export function createSaveQuitGuard({
  drain,
  confirmUnfinished,
  resumeQuit,
  isUpdateInstallReady = () => false,
  onCancelled = () => {},
  timeoutMs = 3_500,
}: SaveQuitOptions) {
  let ready = false;
  let waiting = false;
  return async (event: QuitEvent): Promise<void> => {
    // The explicit update install already drained saves. Let Squirrel finish its own quit;
    // cancelling it and replacing it with app.quit() can interrupt the installation.
    if (isUpdateInstallReady()) return;
    if (ready) return;
    event.preventDefault();
    if (waiting) return;
    waiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      try {
        await Promise.race([
          drain(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Changes are still saving.")), timeoutMs);
          }),
        ]);
      } catch {
        if (!(await confirmUnfinished())) return;
      } finally {
        if (timer) clearTimeout(timer);
      }
      ready = true;
      // Let the original cancelled native quit finish before sending another request.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      resumeQuit();
    } finally {
      waiting = false;
      if (!ready) onCancelled();
    }
  };
}
