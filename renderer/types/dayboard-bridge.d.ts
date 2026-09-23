import type { DayboardBridge } from "../../shared/bridge-protocol";

declare global {
  interface Window {
    dayboard: DayboardBridge;
  }
}

export {};
