import { existsSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";

interface GoogleOAuthBuildOptions {
  file: string;
  required: boolean;
  testBuild: boolean;
}

export function createGoogleOAuthClientPlugin(options: GoogleOAuthBuildOptions): Plugin {
  let warned = false;
  return {
    name: "dayboard:inject-google-oauth-client",
    load(id) {
      if (!/[\\/]main[\\/]services[\\/]google-oauth-app-client\.ts$/.test(id)) return null;
      if (options.testBuild) {
        if (options.required) this.error("A Google-enabled build cannot use DAYBOARD_TEST=1.");
        return 'export const GOOGLE_APP_CLIENT_ID = ""; export const GOOGLE_APP_CLIENT_SECRET = "";';
      }
      let client: { clientId?: unknown; clientSecret?: unknown } | null = null;
      if (existsSync(options.file)) {
        try {
          client = JSON.parse(readFileSync(options.file, "utf8"));
        } catch {
          this.error("[google-oauth] Cannot read a valid Desktop OAuth client JSON file.");
        }
      }
      if (
        typeof client?.clientId !== "string" ||
        !client.clientId.endsWith(".apps.googleusercontent.com") ||
        typeof client.clientSecret !== "string" ||
        !client.clientSecret.trim()
      ) {
        if (options.required) {
          this.error("[google-oauth] This build requires a valid Desktop OAuth client.");
        }
        if (!warned) {
          this.warn("[google-oauth] This build ships without Google sign-in.");
          warned = true;
        }
        return null;
      }
      this.addWatchFile(options.file);
      return (
        `export const GOOGLE_APP_CLIENT_ID = ${JSON.stringify(client.clientId)};\n` +
        `export const GOOGLE_APP_CLIENT_SECRET = ${JSON.stringify(client.clientSecret)};\n`
      );
    },
  };
}
