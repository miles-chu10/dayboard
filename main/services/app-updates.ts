import type { AppUpdateState } from "../../shared/app-updates.js";

export interface UpdateClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  setFeedURL(options: { provider: "github"; owner: string; repo: string }): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean;
    updateInfo: { version: string };
  } | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(): void;
}

export interface AppUpdatesOptions {
  isOfficialRelease: boolean;
  isPackaged: boolean;
  isDemo: () => boolean;
  currentVersion: string;
  loadUpdater: () => Promise<UpdateClient>;
  prepareForInstall: () => Promise<void>;
  resumeAfterInstallFailure: () => void;
  onChange?: (state: AppUpdateState) => void;
  checkTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

const UNAVAILABLE_MESSAGE = "Updates are available only in official DayBoard downloads.";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The update operation failed.";
}

function boundedPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

/** All updater actions are invoked only by explicit user requests. */
export function createAppUpdates(options: AppUpdatesOptions) {
  const available = () => options.isOfficialRelease && options.isPackaged && !options.isDemo();
  let state: AppUpdateState = {
    phase: "unavailable",
    message: UNAVAILABLE_MESSAGE,
    currentVersion: options.currentVersion,
    availableVersion: null,
    progressPercent: null,
    error: null,
  };
  let clientPromise: Promise<UpdateClient> | null = null;
  let inFlight: Promise<AppUpdateState> | null = null;
  let installPromise: Promise<AppUpdateState> | null = null;
  let operation = 0;
  let downloadedEvent = false;
  let checkEvent: "available" | "up-to-date" | null = null;

  function publish(patch: Partial<AppUpdateState>): AppUpdateState {
    state = { ...state, ...patch };
    options.onChange?.({ ...state });
    return { ...state };
  }

  function status(): AppUpdateState {
    if (!available()) {
      if (state.phase !== "unavailable")
        publish({
          phase: "unavailable",
          message: UNAVAILABLE_MESSAGE,
          availableVersion: null,
          progressPercent: null,
          error: null,
        });
      return { ...state };
    }
    if (state.phase === "unavailable")
      publish({ phase: "idle", message: "Check for updates when you're ready." });
    return { ...state };
  }

  function failInstall(error: unknown): void {
    if (state.phase !== "preparing" && state.phase !== "installing") return;
    try {
      options.resumeAfterInstallFailure();
      publish({
        phase: "downloaded",
        message: "Update ready; installation could not start.",
        error: errorMessage(error),
      });
    } catch (resumeError) {
      publish({
        phase: "error",
        message: "DayBoard could not resume after the update failed.",
        error: errorMessage(resumeError),
      });
    }
  }

  async function client(): Promise<UpdateClient> {
    if (!clientPromise) {
      clientPromise = options
        .loadUpdater()
        .then((updater) => {
          updater.autoDownload = false;
          updater.autoInstallOnAppQuit = false;
          updater.allowPrerelease = /-/.test(options.currentVersion);
          updater.allowDowngrade = false;
          updater.setFeedURL({ provider: "github", owner: "miles-chu10", repo: "dayboard" });
          updater.on("update-available", (info: { version: string }) => {
            if (state.phase !== "checking") return;
            checkEvent = "available";
            publish({ availableVersion: info.version });
          });
          updater.on("update-not-available", () => {
            if (state.phase === "checking") checkEvent = "up-to-date";
          });
          updater.on("download-progress", (info: { percent: number }) => {
            if (state.phase !== "downloading") return;
            publish({ progressPercent: boundedPercent(info.percent) });
          });
          updater.on("update-downloaded", (info: { version: string }) => {
            if (state.phase !== "downloading" || info.version !== state.availableVersion) return;
            downloadedEvent = true;
            publish({
              phase: "downloaded",
              progressPercent: 100,
              message: "Update ready to install.",
            });
          });
          updater.on("error", (error: Error) => {
            if (state.phase === "preparing" || state.phase === "installing") {
              failInstall(error);
              return;
            }
            if (!inFlight && state.phase !== "checking" && state.phase !== "downloading") return;
            publish({
              phase: "error",
              message: "Update failed. Try again later.",
              error: errorMessage(error),
            });
          });
          return updater;
        })
        .catch((error: unknown) => {
          clientPromise = null;
          throw error;
        });
    }
    return clientPromise;
  }

  function run(
    phase: "checking" | "downloading",
    timeoutMs: number,
    task: () => Promise<void>,
  ): Promise<AppUpdateState> {
    if (inFlight) return inFlight;
    const id = ++operation;
    publish({
      phase,
      message: phase === "checking" ? "Checking for updates…" : "Downloading update…",
      error: null,
      progressPercent: phase === "downloading" ? 0 : null,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = task();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Update operation timed out. Restart DayBoard before retrying.")),
        timeoutMs,
      );
    });
    const result = Promise.race([source, timeout])
      .then(() => ({ ...state }))
      .catch((error: unknown) => {
        if (operation === id) {
          publish({
            phase: "error",
            message: "Update failed. Try again later.",
            error: errorMessage(error),
          });
        }
        return { ...state };
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
    // A timed-out native request may still be active. Block a second request until it settles.
    inFlight = result;
    void source
      .finally(() => {
        if (operation === id) inFlight = null;
      })
      .catch(() => undefined);
    return result;
  }

  function check(): Promise<AppUpdateState> {
    if (!available()) return Promise.resolve(status());
    if (inFlight) return inFlight;
    if (state.phase === "downloaded" || state.phase === "preparing" || state.phase === "installing")
      return Promise.resolve(status());
    checkEvent = null;
    downloadedEvent = false;
    return run("checking", options.checkTimeoutMs ?? 30_000, async () => {
      const updater = await client();
      const result = await updater.checkForUpdates();
      if (state.phase !== "checking") return;
      if (!result) throw new Error("The updater is unavailable in this build.");
      if (result.isUpdateAvailable && checkEvent !== "up-to-date") {
        publish({
          phase: "available",
          message: `DayBoard ${result.updateInfo.version} is available.`,
          availableVersion: result.updateInfo.version,
        });
      } else if (!result.isUpdateAvailable && checkEvent !== "available") {
        publish({
          phase: "up-to-date",
          message: "DayBoard is up to date.",
          availableVersion: null,
        });
      } else {
        throw new Error("The update check finished without a result.");
      }
    });
  }

  function download(): Promise<AppUpdateState> {
    if (!available()) return Promise.resolve(status());
    if (inFlight) return inFlight;
    if (state.phase !== "available" || !state.availableVersion) return Promise.resolve(status());
    downloadedEvent = false;
    return run("downloading", options.downloadTimeoutMs ?? 10 * 60_000, async () => {
      const updater = await client();
      await updater.downloadUpdate();
      if (state.phase === "error") return;
      if (!downloadedEvent) throw new Error("The updater did not verify a completed download.");
    });
  }

  function install(): Promise<AppUpdateState> {
    if (!available()) return Promise.resolve(status());
    if (installPromise) return installPromise;
    if (inFlight || state.phase !== "downloaded" || !downloadedEvent)
      return Promise.resolve(status());
    publish({
      phase: "preparing",
      message: "Finishing DayBoard work before installation…",
      error: null,
    });
    installPromise = (async () => {
      try {
        const updater = await client();
        if (state.phase !== "preparing") return status();
        await options.prepareForInstall();
        if (state.phase !== "preparing") return status();
        publish({
          phase: "installing",
          message: "Installing update and restarting DayBoard…",
          error: null,
        });
        updater.quitAndInstall();
      } catch (error) {
        failInstall(error);
      }
      return status();
    })().finally(() => {
      installPromise = null;
    });
    return installPromise;
  }

  return { status, check, download, install };
}
