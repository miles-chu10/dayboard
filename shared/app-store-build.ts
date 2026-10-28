declare const __DAYBOARD_MAS_BUILD__: boolean;

/**
 * True in the sandboxed Mac App Store edition. The sandbox makes child processes inherit it, and
 * App Review forbids running code from outside the bundle, so this edition never spawns the
 * subscription CLIs, a login shell or stdio MCP servers, and the App Store owns updates.
 */
export const isAppStoreBuild =
  typeof __DAYBOARD_MAS_BUILD__ !== "undefined" && __DAYBOARD_MAS_BUILD__;

export const APP_STORE_STDIO_MESSAGE =
  "The App Store edition of DayBoard connects to MCP servers by URL only.";
