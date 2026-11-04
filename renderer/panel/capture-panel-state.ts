// Quick Capture panel state, kept pure so the tricky parts (late failures while Miles is typing)
// are unit-tested.

import { aiCaptureEnabled, type ItemDraft, type ItemKind } from "../../shared/capture";
import { isLicenseBlocking, type AiLockState, type LicenseStatus } from "../../shared/license";

export interface CaptureRecordView {
  id: string;
  text: string;
  draft: ItemDraft | null;
  partial: Partial<ItemDraft> | null;
  state: "processing" | "created" | "undone" | "failed";
  error: string | null;
  /** "license" when the license locked the AI parse. */
  reason: "license" | null;
  createdAt: string;
  canUndo: boolean;
}

export interface PanelFailure {
  key: string;
  text: string;
  error: string;
  partial: Partial<ItemDraft> | null;
  reason: "license" | null;
}

/**
 * Whether a panel offers AI capture: it is on in settings and the license doesn't lock AI. `lock`
 * names the license state when it does; the manual form stays free. A license status that hasn't
 * loaded locks nothing, since the capture service checks again right before the AI call.
 */
export function panelAiCapture(
  settings: Parameters<typeof aiCaptureEnabled>[0] | undefined,
  license: LicenseStatus | undefined,
): { available: boolean; lock: AiLockState | null } {
  if (!settings || !aiCaptureEnabled(settings)) return { available: false, lock: null };
  if (license && isLicenseBlocking(license)) return { available: false, lock: license.state };
  return { available: true, lock: null };
}

export interface CapturePanelState {
  text: string;
  mode: "text" | "form";
  form: ItemDraft | null;
  failures: PanelFailure[];
  /** Failure keys Miles dismissed or edited; a repeated broadcast must not bring them back. */
  handled: string[];
}

export type CapturePanelAction =
  | { type: "accountChanged" }
  | { type: "typed"; text: string }
  | { type: "submitted" }
  | {
      type: "rejected";
      key: string;
      text: string;
      error: string;
      /** The submitted manual draft, so Edit restores every field. */
      partial?: Partial<ItemDraft> | null;
    }
  | { type: "recordsChanged"; records: CaptureRecordView[] }
  | {
      type: "editFailure";
      key: string;
      defaultKind: ItemKind;
      available: Record<ItemKind, boolean>;
    }
  | { type: "dismissFailure"; key: string }
  | {
      type: "shown";
      aiAvailable: boolean;
      defaultKind: ItemKind;
      available: Record<ItemKind, boolean>;
    }
  | { type: "formChanged"; patch: Partial<ItemDraft> }
  | { type: "useText" };

export const initialCaptureState: CapturePanelState = {
  text: "",
  mode: "text",
  form: null,
  failures: [],
  handled: [],
};

function blank(kind: ItemKind): ItemDraft {
  return { kind, title: "", notes: "", date: "", time: "", endTime: "" };
}

function addFailure(state: CapturePanelState, failure: PanelFailure): CapturePanelState {
  if (
    state.handled.includes(failure.key) ||
    state.failures.some((item) => item.key === failure.key)
  )
    return state;
  return { ...state, failures: [failure, ...state.failures].slice(0, 5) };
}

export function reduceCapturePanel(
  state: CapturePanelState,
  action: CapturePanelAction,
): CapturePanelState {
  switch (action.type) {
    case "accountChanged":
      return initialCaptureState;
    case "typed":
      return { ...state, text: action.text };
    case "submitted":
      return { ...state, text: "", form: state.mode === "form" ? null : state.form };
    case "rejected":
      return addFailure(state, {
        key: action.key,
        text: action.text,
        error: action.error,
        partial: action.partial ?? null,
        reason: null,
      });
    case "recordsChanged":
      return action.records
        .filter((record) => record.state === "failed")
        .reduce(
          (next, record) =>
            addFailure(next, {
              key: record.id,
              text: record.text,
              error: record.error ?? "Couldn't add this.",
              partial: record.partial,
              reason: record.reason === "license" ? "license" : null,
            }),
          state,
        );
    case "editFailure": {
      const failure = state.failures.find((item) => item.key === action.key);
      if (!failure) return state;
      const form = { ...blank(action.defaultKind), title: failure.text, ...failure.partial };
      if (!action.available[form.kind] && action.available[action.defaultKind])
        form.kind = action.defaultKind;
      return {
        ...state,
        mode: "form",
        form,
        failures: state.failures.filter((item) => item.key !== action.key),
        handled: [...state.handled, action.key],
      };
    }
    case "dismissFailure":
      return {
        ...state,
        failures: state.failures.filter((item) => item.key !== action.key),
        handled: [...state.handled, action.key],
      };
    case "shown": {
      const current = state.form ?? blank(action.defaultKind);
      const form =
        !action.available[current.kind] && action.available[action.defaultKind]
          ? { ...current, kind: action.defaultKind }
          : current;
      if (!action.aiAvailable) {
        // Text typed while settings were still loading becomes the manual form's title.
        if (state.text && !form.title)
          return { ...state, text: "", mode: "form", form: { ...form, title: state.text } };
        return {
          ...state,
          mode: "form",
          form,
        };
      }
      return state.mode === "form" && state.form ? { ...state, form } : { ...state, mode: "text" };
    }
    case "formChanged":
      return state.form ? { ...state, form: { ...state.form, ...action.patch } } : state;
    case "useText":
      return { ...state, mode: "text", form: null };
  }
}
