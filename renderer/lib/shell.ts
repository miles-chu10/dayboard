/** Reconciled from the private DayBoard design-system v21 handoff. */
export const INSPECTOR_SIZE = { default: 280, min: 240, max: 380 } as const;
export const CONTENT_MIN = 440;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function inspectorWidth(available: number, remembered: number): number | null {
  const room = available - CONTENT_MIN - 1;
  return room < INSPECTOR_SIZE.min
    ? null
    : Math.min(clamp(remembered, INSPECTOR_SIZE.min, INSPECTOR_SIZE.max), room);
}

export function separatorKey(
  key: string,
  shift: boolean,
  current: number,
  min: number,
  max: number,
  direction: 1 | -1 = 1,
): number | null {
  const step = shift ? 32 : 8;
  if (key === "ArrowRight") return clamp(current + step * direction, min, max);
  if (key === "ArrowLeft") return clamp(current - step * direction, min, max);
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}
