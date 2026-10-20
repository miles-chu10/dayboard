// Quick Capture's global shortcut. Framework-free: index.ts injects globalShortcut and the
// macOS shortcut reader, so this logic is unit-tested and portable.

import {
  formatAccelerator,
  normalizeAccelerator,
  symbolicHotkeyConflict,
} from "../../shared/accelerator.js";
import type { SystemSettings } from "../shared-types.js";

export interface HotkeyStatus {
  accelerator: string;
  enabled: boolean;
  registered: boolean;
  conflict: string | null;
}

export interface HotkeyDeps {
  /** False in test builds: never grab a system-wide shortcut there. */
  nativeEnabled: boolean;
  globalShortcut: {
    /** Glaze registers asynchronously and resolves false when another app owns the shortcut. */
    register(accelerator: string, callback: () => void): Promise<boolean> | boolean;
    unregister(accelerator: string): void;
  };
  /** com.apple.symbolichotkeys as JSON, or null when it can't be read. */
  readSymbolicHotkeys(): Promise<unknown>;
  onTrigger(): void;
  onStatus(status: HotkeyStatus): void;
}

export function createHotkeyManager(deps: HotkeyDeps) {
  let config: SystemSettings["quickCapture"] = { enabled: false, hotkey: "" };
  let suspended = false;
  let active: string | null = null;
  let generation = 0;
  // Glaze registers asynchronously; a newer sync waits for a pending registration to settle so
  // its release() can free whatever that registration took.
  let inflight: Promise<unknown> | null = null;
  let status: HotkeyStatus = { accelerator: "", enabled: false, registered: false, conflict: null };

  function release(): void {
    if (active) deps.globalShortcut.unregister(active);
    active = null;
  }

  async function sync(): Promise<HotkeyStatus> {
    const current = ++generation;
    if (inflight) await inflight;
    release();
    const accelerator = normalizeAccelerator(config.hotkey) ?? config.hotkey;
    let registered = false;
    let conflict: string | null = null;
    if (config.enabled && deps.nativeEnabled && accelerator) {
      const plist = await deps.readSymbolicHotkeys();
      // A newer change or suspension started while macOS's shortcuts were read: it owns the
      // registration, so this one must not register a shortcut nothing will unregister.
      if (current !== generation) return status;
      const owner = plist === null ? null : symbolicHotkeyConflict(plist, accelerator);
      if (owner)
        conflict = `macOS uses ${formatAccelerator(accelerator)} for ${owner}. Turn it off in System Settings → Keyboard → Keyboard Shortcuts, or choose another shortcut.`;
      if (!suspended) {
        const attempt = Promise.resolve()
          .then(() => deps.globalShortcut.register(accelerator, deps.onTrigger))
          .catch(() => false);
        inflight = attempt;
        registered = await attempt;
        if (inflight === attempt) inflight = null;
        // Recorded even when superseded: the newer sync waits for this one and releases it.
        if (registered) active = accelerator;
        if (current !== generation) return status;
        if (!registered)
          conflict ??= `${formatAccelerator(accelerator)} is in use by another app. Choose a different shortcut.`;
      }
    }
    status = { accelerator, enabled: config.enabled, registered, conflict };
    deps.onStatus(status);
    return status;
  }

  return {
    apply(next: SystemSettings["quickCapture"]): Promise<HotkeyStatus> {
      config = { ...next };
      return sync();
    },
    /** While Settings records a new shortcut, the old one must reach the recorder instead. */
    async suspend(next: boolean): Promise<HotkeyStatus> {
      if (suspended === next) return status;
      suspended = next;
      return sync();
    },
    status: (): HotkeyStatus => status,
    dispose: release,
  };
}
