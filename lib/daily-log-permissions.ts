/**
 * Daily-log edit permissions — PURE, client-safe rule.
 *
 * This module has NO Supabase / server imports so it can be imported by client
 * components (the per-card detail pages in Sessions 3.2/3.3/4.1 import `canEditDay`
 * to drive disabled state). The server-side wrapper that reads the DB lives in
 * `services/daily-log-permissions-service.ts`.
 *
 * Date-edit rule (docs/CLIENT-PORTAL-REDESIGN.md "Date edit rules"):
 *   - Today: always editable.
 *   - Past day, never logged: editable (fill in missed logs after the fact).
 *   - Past day, logged: locked (display-only).
 *   - Future day: view-only (locked).
 * "Today" is computed in the client's IANA timezone, not the server's.
 */

import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

/** Per-card resource the rule applies to. `habit`/`training` are reserved for later sessions. */
export type DailyLogResourceType = "nutrition" | "wellness" | "habit" | "training";

/** Whether the resource already has a logged row for the day. */
export type DayLogStatus = "logged" | "never-logged";

/**
 * Thrown by `assertCanEdit` when a write targets a locked day. Routes translate
 * `instanceof DayLockedError` into a 403. Plain Error subclass (client-safe).
 */
export class DayLockedError extends Error {
  readonly date: string;
  readonly resourceType: DailyLogResourceType;

  /** `reason` replaces the generic sentence when the lock has a more specific
   *  cause the client should be told (e.g. logged on another day). */
  constructor(date: string, resourceType: DailyLogResourceType, reason?: string) {
    super(reason ?? `This ${resourceType} entry for ${date} is locked and cannot be edited.`);
    this.name = "DayLockedError";
    this.date = date;
    this.resourceType = resourceType;
  }
}

/**
 * Pure decision: is `date` editable given the resource's log status and the
 * client's timezone? Compares calendar dates as YYYY-MM-DD strings (lexicographic
 * order is correct for that format and avoids any Date/DST math here — the only
 * timezone-sensitive step is deriving the client's "today", done via Intl).
 *
 * @param date - target day, YYYY-MM-DD
 * @param loggedStatus - whether the resource already has a row for `date`
 * @param clientTimezone - IANA zone; invalid values fall back to UTC
 */
export function canEditDay(
  date: string,
  loggedStatus: DayLogStatus,
  clientTimezone: string
): boolean {
  const today = getTodayDateStringInTimezone(clientTimezone);
  if (date === today) return true; // today: always editable
  if (date > today) return false; // future: view-only
  return loggedStatus === "never-logged"; // past: editable only if never logged
}
