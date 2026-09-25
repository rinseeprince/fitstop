/**
 * "Did the client log today?" answered once.
 *
 * A logged day is a day with any log the client made THEMSELVES, on their own
 * calendar: a nutrition entry, a wellness reading, a habit log, a workout log,
 * or a body measurement they logged in the app. One is enough. Coach entries,
 * intake readings and the check-in submission itself do not count — the
 * question is daily engagement, not the coach's work or the weekly report
 * (owner decision D11, 2026-09-02).
 *
 * A day-form row (`wellness_logs`, `nutrition_logs`) is not an activity flag:
 * workouts and habits write none, so a count of day-form rows reads a client
 * who only trains as silent. Every reader assembles the five sources from the
 * rows it holds and asks this kernel; `lib/logged-days-ownership.test.ts`
 * keeps it that way.
 *
 * Pure and isomorphic: no server import, so the browser can run it too.
 */

/** The five sources, and the only five. A coach entry or a check-in has no way in. */
export const LOGGED_DAY_SOURCES = [
  "wellness",
  "nutrition",
  "habits",
  "training",
  "measurements",
] as const;

export type LoggedDaySource = (typeof LOGGED_DAY_SOURCES)[number];

/** Five lists of `YYYY-MM-DD` dates on the client's calendar, one per source. */
export type LoggedDaySources = Record<LoggedDaySource, readonly string[]>;

type DateRange = { from: string; to: string };

/**
 * The sorted set of days inside `range` with a log from any source. Dates are
 * `YYYY-MM-DD`, so string comparison is date comparison.
 */
export function loggedDays(sources: LoggedDaySources, range: DateRange): string[] {
  const days = new Set<string>();
  for (const source of LOGGED_DAY_SOURCES) {
    for (const date of sources[source]) {
      if (date >= range.from && date <= range.to) days.add(date);
    }
  }
  return [...days].sort();
}

// ---------------------------------------------------------------------------
// The source predicates, spelled once. A reader holds rows of its own shape
// and maps them onto these; the definition of what counts lives here.
// ---------------------------------------------------------------------------

type Maybe = number | null | undefined;

type WellnessValues = {
  mood?: Maybe;
  energy?: Maybe;
  sleep?: Maybe;
  stress?: Maybe;
  soreness?: Maybe;
};

/**
 * A wellness row counts when it carries at least one reading. Every reader
 * holds assembled days (`DailyLog`), where a day with a food row and no
 * wellness row carries no score, so "carries a reading" is the one predicate
 * every reader can apply to what it holds.
 */
export function hasWellnessReading(row: WellnessValues): boolean {
  return (
    row.mood != null ||
    row.energy != null ||
    row.sleep != null ||
    row.stress != null ||
    row.soreness != null
  );
}

type NutritionValues = {
  caloriesConsumed?: Maybe;
  proteinG?: Maybe;
  carbsG?: Maybe;
  fatG?: Maybe;
};

/** A nutrition row counts when it carries at least one consumed value. */
export function hasNutritionEntry(row: NutritionValues): boolean {
  return (
    row.caloriesConsumed != null ||
    row.proteinG != null ||
    row.carbsG != null ||
    row.fatG != null
  );
}

/**
 * A workout log is a training event the client has logged, at any quality —
 * `completed` says exactly that and says nothing about how it went (migration
 * 182). A still-scheduled event is the ABSENCE of a log.
 */
export function isTrainingLogStatus(status: string): boolean {
  return status === "completed";
}

/**
 * A measurement the client logged themselves. Every other source on the log —
 * `check_in`, `coach_entry`, `intake` — is the coach's work or the weekly
 * report, and neither counts.
 */
export const CLIENT_MEASUREMENT_SOURCE = "client_log";
