// Pure state machine for the bridge's stream protocol (see shared/bridge-protocol.ts and
// main/platform/README.md). No Electron imports so it can run under plain `node --test`.

export interface StreamContext {
  signal: AbortSignal;
}

export type StreamHandler<TPayload = unknown, TChunk = unknown, TResult = unknown> = (
  payload: TPayload,
  sendChunk: (chunk: TChunk) => void,
  context: StreamContext,
) => Promise<TResult>;

export interface StreamStartRequest {
  id: string;
  channel: string;
  args: unknown;
}

/** How long a cancel that arrives before its matching start is remembered. */
const CANCEL_MEMORY_MS = 5_000;

interface RunningStream {
  senderId: number;
  controller: AbortController;
}

/**
 * Tracks in-flight `handleStream` invocations keyed by (senderId, streamId), so a cancel or a
 * destroyed sender can abort the right one, and a cancel that races ahead of its start is not lost.
 */
export class StreamRegistry {
  private readonly handlers = new Map<string, StreamHandler>();
  private readonly running = new Map<string, RunningStream>();
  private readonly recentlyCancelled = new Map<string, ReturnType<typeof setTimeout>>();

  registerHandler<TPayload, TChunk, TResult>(
    channel: string,
    handler: StreamHandler<TPayload, TChunk, TResult>,
  ): void {
    if (this.handlers.has(channel)) {
      throw new Error(`A stream handler is already registered for "${channel}"`);
    }
    this.handlers.set(channel, handler as StreamHandler);
  }

  private key(senderId: number, id: string): string {
    return `${senderId}:${id}`;
  }

  /**
   * Runs the handler for `request.channel`, forwarding chunks through `emitChunk`. Resolves with
   * the handler's final result, rejects on error or cancellation.
   */
  async start(
    request: StreamStartRequest,
    senderId: number,
    emitChunk: (chunk: unknown) => void,
  ): Promise<unknown> {
    const handler = this.handlers.get(request.channel);
    if (!handler) throw new Error(`No stream handler registered for "${request.channel}"`);

    const key = this.key(senderId, request.id);
    const controller = new AbortController();

    const cancelTimer = this.recentlyCancelled.get(key);
    if (cancelTimer) {
      clearTimeout(cancelTimer);
      this.recentlyCancelled.delete(key);
      controller.abort();
    }

    this.running.set(key, { senderId, controller });
    try {
      return await handler(request.args, emitChunk, {
        signal: controller.signal,
      });
    } finally {
      this.running.delete(key);
    }
  }

  /** Aborts a running stream, or remembers the cancel briefly if its start hasn't arrived yet. */
  cancel(senderId: number, id: string): void {
    const key = this.key(senderId, id);
    const entry = this.running.get(key);
    if (entry) {
      entry.controller.abort();
      return;
    }
    const existing = this.recentlyCancelled.get(key);
    if (existing) clearTimeout(existing);
    this.recentlyCancelled.set(
      key,
      setTimeout(() => this.recentlyCancelled.delete(key), CANCEL_MEMORY_MS),
    );
  }

  /** Aborts every stream owned by a sender whose webContents was destroyed. */
  disposeSender(senderId: number): void {
    for (const [key, entry] of this.running) {
      if (entry.senderId === senderId) {
        entry.controller.abort();
        this.running.delete(key);
      }
    }
  }

  /** Test/diagnostic helper: number of streams currently running. */
  get runningCount(): number {
    return this.running.size;
  }
}
