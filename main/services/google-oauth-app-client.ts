/**
 * App-owned Google OAuth client for DayBoard (Web application).
 * End users never enter these — they only sign in with Google in the browser.
 *
 * Redirect URI (must match the client): https://www.glaze.app/api/oauth/callback
 * APIs: Tasks, Gmail, Calendar
 *
 * Leave blank to fall back to a legacy per-Mac client saved before public login.
 * For Store builds, set both values so every install can Connect Google.
 */
export const GOOGLE_APP_CLIENT_ID = "";
export const GOOGLE_APP_CLIENT_SECRET = "";
