import type { RequestUsage } from "../../../shared/ai-usage.js";

// Every finished AI request reports here, whichever feature made it; the usage log listens.
const listeners = new Set<(usage: RequestUsage) => void>();

export function onRequestUsage(listener: (usage: RequestUsage) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitRequestUsage(usage: RequestUsage | undefined): void {
  if (!usage) return;
  for (const listener of listeners) listener(usage);
}
