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
 * The `daily_logs` spine row is the parent of the client's day-form (wellness,
 * nutrition, the day note), not an activity flag: workouts and habits never
 * create one, so counting spine rows read a client who only trains as silent.
 * Three readers used to answer the question three ways; every reader now
 * assembles the five sources from the rows it holds and asks this kernel.
 * `lib/logged-days-ownership.test.ts` keeps it that way.
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
 * A wellness row counts when it carries at least one reading. The attention
 * feed holds `daily_logs_full` rows, which cannot tell an absent child from an
 * empty one, so "carries a reading" is the one predicate every reader can
 * apply to what it holds.
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
 * A workout log is a training event the client has logged, at any quality.
 * A scheduled, missed or skipped event is the ABSENCE of a log. This is the
 * one line that narrows to `completed` when the training-completion vocabulary
 * retires `partial` from the event status (docs/TRAINING-COMPLETION-EXECUTION-PLAN.md).
 */
const TRAINING_LOG_STATUSES = ["completed", "partial"] as const;

export function isTrainingLogStatus(status: string): boolean {
  return (TRAINING_LOG_STATUSES as readonly string[]).includes(status);
}

/**
 * A measurement the client logged themselves. Every other source on the log —
 * `check_in`, `coach_entry`, `intake` — is the coach's work or the weekly
 * report, and neither counts.
 */
export const CLIENT_MEASUREMENT_SOURCE = "client_log";
