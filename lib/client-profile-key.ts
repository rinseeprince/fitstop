/**
 * The client's own profile read (`GET /api/client/me`), which carries the day
 * rule's boundary (`logsOpenFrom`). Its hook and invalidator live in
 * hooks/use-client-profile.ts, which exports this key with them; the key
 * stands alone here so a module that lands a fresh profile (the habit entry
 * hook, after a locked-day refusal) needs nothing of the auth context.
 */
export const CLIENT_PROFILE_KEY = "/api/client/me";
