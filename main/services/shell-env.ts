import { execFile } from "node:child_process";

/** Runs a command in the user's login shell and returns only the output between markers. */
export function runLoginShell(command: string, timeoutMs = 8000): Promise<string> {
  const marker = `__GLZ_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  return new Promise((resolve) => {
    execFile(
      process.env.SHELL || "/bin/zsh",
      ["-lc", `printf "%s" "${marker}"; ${command}; printf "%s" "${marker}"`],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (_error, stdout) => {
        const text = String(stdout ?? "");
        const start = text.indexOf(marker);
        const end = text.lastIndexOf(marker);
        resolve(start >= 0 && end > start ? text.slice(start + marker.length, end) : "");
      },
    );
  });
}

let loginPath: Promise<string> | null = null;

/** GUI apps inherit a minimal PATH; merge in the login shell's so npx, node, and CLIs resolve. */
export function getLoginPath(): Promise<string> {
  loginPath ??= runLoginShell('printf "%s" "$PATH"').then((shellPath) => {
    const parts = [
      ...shellPath.split(":"),
      ...(process.env.PATH ?? "").split(":"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
    return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(":");
  });
  return loginPath;
}

export async function getToolEnv(strip: string[] = []): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: await getLoginPath() };
  for (const key of strip) delete env[key];
  return env;
}

export function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
