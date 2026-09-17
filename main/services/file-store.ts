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
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, target);
}

/** Runs async operations one at a time so concurrent saves never interleave. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.catch(() => undefined);
    return run;
  };
}
