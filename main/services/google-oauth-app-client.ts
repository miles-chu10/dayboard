/**
 * App-owned Google OAuth client for DayBoard (Desktop app type).
 * End users never enter these — they only sign in with Google in the browser.
 *
 * Real values are injected at bundle time from DAYBOARD_GOOGLE_OAUTH_FILE or the developer's
 * ~/.config/dayboard/google-oauth.json (see electron.vite.config.ts). They ship in the app but
 * never live in the source repository.
 * Without that file, Google sign-in reports itself as not configured.
 *
 * Desktop clients sign in with PKCE and a 127.0.0.1 loopback redirect (google-loopback-oauth.ts);
 * Google treats a Desktop client's secret as non-confidential. Never put a Web client here.
 * APIs: Tasks, Gmail, Calendar
 */
export const GOOGLE_APP_CLIENT_ID = "";
export const GOOGLE_APP_CLIENT_SECRET = "";
