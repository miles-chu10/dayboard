export type AppUpdatePhase =
  | "unavailable"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "preparing"
  | "installing"
  | "error";

/** The complete, serializable state sent through the trusted DayBoard bridge. */
export interface AppUpdateState {
  phase: AppUpdatePhase;
  message: string;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}
