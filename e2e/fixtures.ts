import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareIsolatedProfile,
  resolveProfileOverride,
  type IsolatedProfileMode,
} from "../main/platform/isolated-profile.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface DemoApp {
  app: ElectronApplication;
  page: Page;
  profile: string;
  errors: string[];
  close: (removeProfile?: boolean) => Promise<void>;
}

export async function createTestProfile(mode: IsolatedProfileMode = "demo"): Promise<string> {
  const profile = await mkdtemp(path.join(tmpdir(), `dayboard-${mode}-e2e-`));
  return prepareIsolatedProfile(profile, mode);
}

async function launchIsolated(profile?: string, demoMode = true): Promise<DemoApp> {
  const requested = profile ?? (await createTestProfile(demoMode ? "demo" : "test"));
  const userData = resolveProfileOverride(requested, [
    path.join(homedir(), "Library", "Application Support", "DayBoard"),
  ]);
  prepareIsolatedProfile(userData, demoMode ? "demo" : "test");
  const errors: string[] = [];
  const environment = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "DISPLAY", "XAUTHORITY"]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key] as string]),
  );
  const packaged = process.env.DAYBOARD_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: [root] }),
    env: {
      ...environment,
      DAYBOARD_USER_DATA: userData,
      DAYBOARD_TEST: "1",
      ...(demoMode ? { DAYBOARD_DEMO: "1" } : {}),
    },
    timeout: 30_000,
  });
  app.on("window", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  try {
    const actual = await app.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
    }));
    if (
      resolveProfileOverride(actual.userData) !== userData ||
      resolveProfileOverride(actual.sessionData) !== userData
    ) {
      throw new Error("The launched app did not use the isolated test profile.");
    }
  } catch (error) {
    await app.close();
    throw error;
  }
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  return {
    app,
    page,
    profile: userData,
    errors,
    async close(removeProfile = true) {
      await app.close();
      if (removeProfile) await rm(userData, { recursive: true, force: true });
    },
  };
}

export function launchDemo(profile?: string): Promise<DemoApp> {
  return launchIsolated(profile);
}

export async function launchEmptyProfile(): Promise<DemoApp> {
  const profile = await createTestProfile("test");
  // A fresh profile alone does not isolate the system's EventKit account. Disable all
  // integrations before boot so this non-demo test can never fetch personal source data.
  await writeFile(
    path.join(profile, "settings.json"),
    JSON.stringify({
      sources: Object.fromEntries(
        ["tasks", "reminders", "mail", "calendar"].map((source) => [source, { enabled: false }]),
      ),
      ai: { enabled: false, providerChosen: false },
      mcpServer: { enabled: false, allowWrites: false },
    }),
  );
  return launchIsolated(profile, false);
}
