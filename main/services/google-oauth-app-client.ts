/**
 * App-owned Google OAuth client for DayBoard (Web application).
 * End users never enter these — they only sign in with Google in the browser.
 *
 * Real values are injected at bundle time from the gitignored `google-oauth.local.json`
 * (see glaze.config.ts), so they ship in the app but never live in git:
 *   { "clientId": "….apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }
 * Without that file, Google sign-in reports itself as not configured.
 *
 * Redirect URI (must match the client): https://www.glaze.app/api/oauth/callback
 * APIs: Tasks, Gmail, Calendar
 */
export const GOOGLE_APP_CLIENT_ID = "";
export const GOOGLE_APP_CLIENT_SECRET = "";
