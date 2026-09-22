/**
 * App-owned Google OAuth client for DayBoard (Desktop app type).
 * End users never enter these — they only sign in with Google in the browser.
 *
 * Real values are injected at bundle time from the gitignored `google-oauth.local.json` (or `~/.config/dayboard/google-oauth.json`)
 * (see glaze.config.ts), so they ship in the app but never live in git:
 *   { "clientId": "….apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }
 * Without that file the build fails.
 *
 * Desktop clients sign in with PKCE and a 127.0.0.1 loopback redirect (google-loopback-oauth.ts);
 * Google treats a Desktop client's secret as non-confidential. Never put a Web client here.
 * APIs: Tasks, Gmail, Calendar
 */
export const GOOGLE_APP_CLIENT_ID = "";
export const GOOGLE_APP_CLIENT_SECRET = "";
