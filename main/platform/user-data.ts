import { app } from "electron";
import {
  prepareIsolatedProfile,
  resolveProfileOverride,
  validateIsolatedProfile,
} from "./isolated-profile.js";

declare const __DAYBOARD_TEST_BUILD__: boolean;

let configured = false;
let configurationError: Error | undefined;

function enabled(name: "DAYBOARD_TEST" | "DAYBOARD_DEMO"): boolean {
  const value = process.env[name];
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`${name} must be 0 or 1 when specified.`);
}

export function configureUserData(): void {
  if (configurationError) throw configurationError;
  if (configured) return;
  try {
    // A packaged test build must fail closed even when LaunchServices drops its environment.
    const testBuild = typeof __DAYBOARD_TEST_BUILD__ !== "undefined" && __DAYBOARD_TEST_BUILD__;
    const demo = enabled("DAYBOARD_DEMO");
    const test = enabled("DAYBOARD_TEST");
    const isolated = testBuild || test || demo;
    const override = process.env.DAYBOARD_USER_DATA;
    if (isolated && override === undefined) {
      throw new Error(
        "Test/demo startup requires an explicit isolated DAYBOARD_USER_DATA directory.",
      );
    }
    if (override !== undefined) {
      const reserved = isolated ? [app.getPath("userData"), app.getPath("sessionData")] : [];
      const target = resolveProfileOverride(override, reserved);
      if (isolated) validateIsolatedProfile(target, demo ? "demo" : "test");
      app.setPath("userData", target);
      if (resolveProfileOverride(app.getPath("userData")) !== target) {
        throw new Error("DayBoard did not apply the requested profile; startup was stopped.");
      }
      app.setPath("sessionData", target);
      if (resolveProfileOverride(app.getPath("sessionData")) !== target) {
        throw new Error("DayBoard did not isolate browser storage; startup was stopped.");
      }
      if (isolated) prepareIsolatedProfile(target, demo ? "demo" : "test");
    }
    configured = true;
  } catch (error) {
    configurationError = error instanceof Error ? error : new Error("Profile isolation failed.");
    throw configurationError;
  }
}
