export function invoke<T = void>(channel: string, ...args: unknown[]): Promise<T> {
  return window.glazeAPI.glaze.ipc.invoke<T>(channel, ...args);
}

export function openExternal(url: string): Promise<void> {
  return invoke("app:openExternal", { url });
}

export function openSettings(): Promise<void> {
  return invoke("window:openSettings");
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}
