import { execFile, spawn } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
class ProcessTreeCleanupError extends Error {}

function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function hasLiveGroup(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  // An orphaned zombie can keep a group ID present until PID 1 reaps it, but
  // cannot execute or write. Count all other states, including stopped members.
  if (process.platform === "linux") {
    const namespace = await readlink("/proc/self/ns/pid");
    for (const entry of await readdir("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const status = await readFile(`/proc/${entry}/status`, "utf8");
        const group = /^NSpgid:\s+(.+)$/m.exec(status)?.[1].trim().split(/\s+/).at(-1);
        if (!group) throw new Error("Process-group status is unavailable.");
        // /proc may be mounted from an outer PID namespace in a test executor.
        if (
          group === String(pid) &&
          !/^State:\s+Z/m.test(status) &&
          (await readlink(`/proc/${entry}/ns/pid`)) === namespace
        )
          return true;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
      }
    }
    return false;
  }
  const { stdout } = await execute("ps", ["-axo", "pgid=,stat="], {
    timeout: 500,
    maxBuffer: 1024 * 1024,
  });
  return stdout
    .trim()
    .split("\n")
    .some((line) => {
      const [group, state] = line.trim().split(/\s+/);
      return group === String(pid) && !state?.startsWith("Z");
    });
}

async function runOwnedCommand(
  command,
  args,
  { cwd, env, signal, stdio = "inherit", termGraceMs = 1000, killWaitMs = 2000 },
) {
  signal.throwIfAborted();
  if (process.platform === "win32") throw new Error("Packaging process ownership requires POSIX.");
  // A new session/group owns npm, its shells and their build descendants. Do not
  // pass signal to spawn: its AbortError would settle before tree termination.
  const child = spawn(command, args, { cwd, env, stdio, detached: true });
  let closed = false;
  let spawnError;
  let onAbort;
  const exit = new Promise((resolve) => {
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      closed = true;
      resolve(code);
    });
  });
  const aborted = new Promise((resolve) => {
    onAbort = resolve;
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) resolve();
  });
  async function waitForTree(milliseconds) {
    const deadline = Date.now() + milliseconds;
    do {
      if (closed && !(await hasLiveGroup(child.pid))) return true;
      await delay(25);
    } while (Date.now() < deadline);
    return false;
  }
  try {
    await Promise.race([exit, aborted]);
    let graceful = false;
    try {
      signalGroup(child.pid, "SIGTERM");
      graceful = await waitForTree(termGraceMs);
    } catch {
      // Still attempt the hard stop if graceful termination or observation fails.
    }
    if (!graceful) {
      try {
        signalGroup(child.pid, "SIGKILL");
        if (!(await waitForTree(killWaitMs))) throw new Error("Process tree still active.");
      } catch (cause) {
        throw new ProcessTreeCleanupError("Could not confirm packaging process-tree termination.", {
          cause,
        });
      }
    }
    signal.throwIfAborted();
    if (spawnError) throw spawnError;
    return await exit;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createOwnedProcessScope(cwd) {
  const controller = new AbortController();
  const active = new Set();
  let unsafeCleanup;
  return {
    run(command, args, options = {}) {
      const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      const pending = runOwnedCommand(command, args, { ...options, cwd, signal });
      active.add(pending);
      pending.then(
        () => active.delete(pending),
        (error) => {
          active.delete(pending);
          if (error instanceof ProcessTreeCleanupError) unsafeCleanup = error;
        },
      );
      return pending;
    },
    async close() {
      controller.abort();
      await Promise.allSettled([...active]);
      if (unsafeCleanup) {
        throw new Error(
          `Packaging workspace retained because process cleanup was unconfirmed: ${cwd}`,
          { cause: unsafeCleanup },
        );
      }
    },
  };
}
