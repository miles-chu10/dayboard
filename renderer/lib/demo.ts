import { invoke } from "./ipc";
import { setStorageNamespace } from "./storage";

let demoMode = false;

/** Must finish before either renderer reads cached state or renders source data. */
export async function initializeDemoMode(): Promise<boolean> {
  const value = await invoke<unknown>("app:isDemo");
  if (typeof value !== "boolean") throw new Error("DayBoard returned an invalid demo-mode state.");
  demoMode = value;
  // Earlier demo builds could contact real AI sources. Their caches are not
  // trusted as screenshot-safe, so this isolated implementation starts fresh.
  setStorageNamespace(demoMode ? "demo:isolated-v2:" : "");
  return demoMode;
}

export function isRendererDemoMode(): boolean {
  return demoMode;
}
