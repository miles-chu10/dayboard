import type { StreamMessage } from "./bridge-protocol";

interface OpenStream {
  onChunk: (chunk: unknown) => void;
  end: () => void;
}

/**
 * The preload's side of a stream. Electron can deliver an invoke's reply before messages that
 * main sent earlier with `webContents.send`, so a stream settles only once its end marker, which
 * follows the last chunk, has arrived. Chunks that arrive after the reply still reach `onChunk`.
 */
export function createStreamClient() {
  const streams = new Map<string, OpenStream>();
  return {
    receive(message: StreamMessage): void {
      const stream = streams.get(message.id);
      if (!stream) return;
      if ("end" in message) stream.end();
      else stream.onChunk(message.chunk);
    },
    async run<T>(
      id: string,
      onChunk: (chunk: unknown) => void,
      start: () => Promise<T>,
    ): Promise<T> {
      if (streams.has(id)) throw new Error(`Stream ${id} is already running`);
      const ended = new Promise<void>((resolve) => streams.set(id, { onChunk, end: resolve }));
      try {
        const outcome = await start().then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        await ended;
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      } finally {
        streams.delete(id);
      }
    },
  };
}
