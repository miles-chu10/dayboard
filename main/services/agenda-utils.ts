/** Local calendar boundaries include DST transitions and the whole selected date. */
export function localDateRange(date: string, days: number): { start: Date; end: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + days);
  return { start, end };
}

/** A failed persistence attempt must never change the in-memory committed state. */
export async function mutateAndPersist<T, R>(
  snapshot: T,
  mutate: (draft: T) => R,
  persist: (draft: T) => Promise<void>,
): Promise<{ state: T; result: R }> {
  const state = structuredClone(snapshot);
  const result = mutate(state);
  await persist(state);
  return { state, result };
}

export function agendaEventId(requestId: string): string {
  return `da${requestId.replace(/-/g, "").toLowerCase()}`;
}
