// Quick Capture panel state, kept pure so the tricky parts (late failures while Miles is typing)
// are unit-tested.

import type { ItemDraft, ItemKind } from "../../shared/capture";

export interface CaptureRecordView {
  id: string;
  text: string;
  draft: ItemDraft | null;
  partial: Partial<ItemDraft> | null;
  state: "processing" | "created" | "undone" | "failed";
  error: string | null;
  createdAt: string;
  canUndo: boolean;
}

export interface PanelFailure {
  key: string;
  text: string;
  error: string;
  partial: Partial<ItemDraft> | null;
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
  | { type: "typed"; text: string }
  | { type: "submitted" }
  | { type: "rejected"; key: string; text: string; error: string }
  | { type: "recordsChanged"; records: CaptureRecordView[] }
  | { type: "editFailure"; key: string; defaultKind: ItemKind }
  | { type: "dismissFailure"; key: string }
  | { type: "shown"; aiAvailable: boolean; defaultKind: ItemKind }
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
    case "typed":
      return { ...state, text: action.text };
    case "submitted":
      return { ...state, text: "", form: state.mode === "form" ? null : state.form };
    case "rejected":
      return addFailure(state, {
        key: action.key,
        text: action.text,
        error: action.error,
        partial: null,
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
            }),
          state,
        );
    case "editFailure": {
      const failure = state.failures.find((item) => item.key === action.key);
      if (!failure) return state;
      const form = { ...blank(action.defaultKind), title: failure.text, ...failure.partial };
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
    case "shown":
      if (!action.aiAvailable)
        return { ...state, mode: "form", form: state.form ?? blank(action.defaultKind) };
      return state.mode === "form" && state.form ? state : { ...state, mode: "text" };
    case "formChanged":
      return state.form ? { ...state, form: { ...state.form, ...action.patch } } : state;
    case "useText":
      return { ...state, mode: "text", form: null };
  }
}
