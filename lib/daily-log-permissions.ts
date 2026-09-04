/**
 * Daily-log edit permissions — PURE, client-safe rule.
 *
 * This module has NO Supabase / server imports so it can be imported by client
 * components (the per-card detail pages import `canEditDay` to drive disabled
 * state). The server-side wrapper that reads the DB lives in
 * `services/daily-log-permissions-service.ts`.
 *
 * Date-edit rule (owner decision 2026-09-04; docs/ARCHITECTURE.md →
 * "Date-edit permissions"):
 *
 *   A client logs the week their CURRENT check-in covers, plus every day since,
 *   up to and including today. That week closes when they submit the check-in,
 *   or when the next check-in day arrives — whichever comes first. Everything
 *   older is locked. The future is locked.
 *
 * So a client is normally logging across about two weeks: the seven days their
 * outstanding check-in reports on, plus the days that have passed since. A
 * check-in they never sent is simply missed: its week locks on the next
 * check-in day and never reopens.
 *
 * This REPLACES the old "past logged → locked" rule (today editable; a past day
 * editable until it was logged; a never-logged past day open for ever). A day's
 * log state no longer decides anything — the only question is which reporting
 * period the day belongs to.
 *
 * "Today" is computed in the client's IANA timezone, not the server's.
 */

import {
  addDaysToDateString,
  getTodayDateStringInTimezone,
  getTodayInTimezone,
  resolveCheckInWindow,
} from "@/lib/date-helpers";
import { checkInWeekday } from "@/lib/check-in-week";

/** Per-card resource the rule applies to. Carried by the error, not by the rule. */
export type DailyLogResourceType = "nutrition" | "wellness" | "habit" | "training";

/**
 * Thrown by `assertCanEdit` when a write targets a locked day. Routes translate
 * `instanceof DayLockedError` into a 403 carrying this message. Plain Error
 * subclass (client-safe).
 *
 * The message names no date: the client is looking at the day already, and the
 * boundary that locked it (a check-in they sent, or one that rolled over) is not
 * something a sentence in a toast can usefully explain (owner, 2026-09-04).
 */
export class DayLockedError extends Error {
  readonly date: string;
  readonly resourceType: DailyLogResourceType;

  constructor(date: string, resourceType: DailyLogResourceType) {
    super("This day is locked.");
    this.name = "DayLockedError";
    this.date = date;
    this.resourceType = resourceType;
  }
}

/** The client facts the boundary is derived from. Structural, so a projection satisfies it. */
type LogWindowSource = {
  /** `clients.next_check_in_due`, YYYY-MM-DD. Absent = no schedule. */
  nextCheckInDue?: string | null;
  /** `clients.start_date`, YYYY-MM-DD. Clamps a partial first week. */
  startDate?: string | null;
  /** IANA zone; invalid values fall back to UTC. */
  timezone: string;
};

/**
 * The first day this client may log — the ONE derivation of the boundary, shared
 * by the server guard and by both wires that carry it to the apps.
 *
 * It is the later of two closes:
 *  - the start of the week the client's CURRENT check-in reports on. That window
 *    comes from `resolveCheckInWindow`, the same function the check-in form uses
 *    to decide which week it is submitting, so the lock and the form can never
 *    disagree about which check-in is outstanding. It rolls on the check-in
 *    weekday itself: on that morning last week's check-in stops being sendable
 *    (the form would submit for the new week), so its days lock the same day.
 *  - the day after the last check-in the client actually sent. Submitting closes
 *    that week and everything before it at once.
 *
 * `null` means no lower bound: a client with no schedule can never check in, so
 * nothing ever closes a week for them and only the future is locked (owner,
 * 2026-09-04). A historical check-in still closes its own period for them.
 */
export function resolveLogsOpenFrom(
  source: LogWindowSource,
  lastSubmittedPeriodEnd: string | null
): string | null {
  const afterSubmitted = lastSubmittedPeriodEnd
    ? addDaysToDateString(lastSubmittedPeriodEnd, 1)
    : null;

  if (!source.nextCheckInDue) return afterSubmitted;

  const { periodStart } = resolveCheckInWindow(
    getTodayInTimezone(source.timezone),
    checkInWeekday(source),
    source.startDate
  );

  if (afterSubmitted === null) return periodStart;
  return afterSubmitted > periodStart ? afterSubmitted : periodStart;
}

/**
 * Pure decision: may `date` be logged? Compares calendar dates as YYYY-MM-DD
 * strings (lexicographic order is correct for that format and avoids any
 * Date/DST math here — the only timezone-sensitive step is deriving the client's
 * "today", done via Intl).
 *
 * @param date - target day, YYYY-MM-DD
 * @param logsOpenFrom - the boundary from `resolveLogsOpenFrom`; null = no lower bound
 * @param clientTimezone - IANA zone; invalid values fall back to UTC
 */
export function canEditDay(
  date: string,
  logsOpenFrom: string | null,
  clientTimezone: string
): boolean {
  if (date > getTodayDateStringInTimezone(clientTimezone)) return false; // future
  return logsOpenFrom === null || date >= logsOpenFrom;
}
