import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function readFileIfExists(target: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeFileAtomic(target: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, target);
  } finally {
    // `rename` removes the temporary file on success. Clean up a failed write without
    // touching the last committed target.
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Runs async operations one at a time so concurrent saves never interleave. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.catch(() => undefined);
    return run;
  };
  enqueue.drain = () => tail.then(() => undefined);
  return enqueue;
}
