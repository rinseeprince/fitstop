/**
 * The realism model: engagement skew, decay, gaps, clustered timestamps, and
 * text with believable length.
 *
 * Uniform data is worse than useless for a performance baseline — it produces
 * evenly distributed indexes and hides exactly the skew that causes real
 * slowdowns. Everything here exists to break that uniformity in the ways
 * production actually does.
 *
 * All date maths is on `YYYY-MM-DD` strings via UTC-noon Date objects. The old
 * scale seed parsed the same string shape as UTC in one place and as local time
 * in another, which silently shifted rows by a day either side of midnight.
 * Nothing here reads the wall clock — the anchor date is always passed in.
 */

import {
  NUTRITION_ADHERENCE_HIT_THRESHOLD,
  NUTRITION_ADHERENCE_PARTIAL_THRESHOLD,
} from "@/lib/constants";
import type { Rng } from "./rng";

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;

/** Parse `YYYY-MM-DD` at UTC noon — far enough from midnight that DST cannot shift the day. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

export function formatDay(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return formatDay(new Date(parseDay(iso).getTime() + n * DAY_MS));
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseDay(toIso).getTime() - parseDay(fromIso).getTime()) / DAY_MS);
}

export const WEEKDAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

/** Lowercase English weekday — the casing `nutrition_events.day_of_week` expects. */
export function dayOfWeekName(iso: string): string {
  return WEEKDAY_NAMES[parseDay(iso).getUTCDay()];
}

export function isWeekend(iso: string): boolean {
  const d = parseDay(iso).getUTCDay();
  return d === 0 || d === 6;
}

/** Monday-anchored week start, matching lib/date-helpers getTrainingWeekStart's default. */
export function mondayOf(iso: string): string {
  const dow = parseDay(iso).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/**
 * Timestamp for a given day, clustered around an hour-of-day profile rather
 * than uniform across 24h. Uniform timestamps degenerate every keyset-pagination
 * benchmark, because "load older" pages then have no realistic clustering.
 */
export function timestampAt(iso: string, hour: number, rng: Rng): string {
  const jitterMin = rng.int(0, 59);
  const jitterSec = rng.int(0, 59);
  const base = parseDay(iso);
  base.setUTCHours(hour, jitterMin, jitterSec, 0);
  return base.toISOString();
}

// ------------------------------------------------------------ archetypes

export type Archetype = {
  key: string;
  /** Share of the client population. */
  share: number;
  /** Probability of producing a daily-log spine row on an eligible day. */
  logDensity: number;
  /** Probability a scheduled training event gets completed. */
  sessionCompletion: number;
  /** Probability a due check-in is submitted. */
  checkInRate: number;
  /** Fraction of the tenure after which the client goes silent (1 = never). */
  churnAt: number;
  /** Probability a completed session carries full set-level detail. */
  setDetail: number;
};

/**
 * Engagement follows a power law. These shares are a product decision, not a
 * schema constraint — the weighted daily-log density is ~0.55, which is what
 * puts wellness_logs near the 100k target while leaving the attention feed and
 * the "never logged" paths reachable (the old fixture logged 100% of days for
 * 100% of clients, so streaks were always 180 and those paths were structurally
 * unreachable).
 */
export const ARCHETYPES: readonly Archetype[] = [
  { key: "power",       share: 0.15, logDensity: 0.95, sessionCompletion: 0.92, checkInRate: 1.00, churnAt: 1.0,  setDetail: 0.95 },
  { key: "steady",      share: 0.35, logDensity: 0.70, sessionCompletion: 0.78, checkInRate: 0.85, churnAt: 1.0,  setDetail: 0.80 },
  { key: "lapsing",     share: 0.30, logDensity: 0.40, sessionCompletion: 0.55, checkInRate: 0.45, churnAt: 0.75, setDetail: 0.55 },
  { key: "churned",     share: 0.15, logDensity: 0.15, sessionCompletion: 0.20, checkInRate: 0.15, churnAt: 0.30, setDetail: 0.30 },
  { key: "never_start", share: 0.05, logDensity: 0.00, sessionCompletion: 0.00, checkInRate: 0.00, churnAt: 0.0,  setDetail: 0.00 },
];

/**
 * The worst case the roster query has to survive.
 *
 * The expensive reads on this platform are per-coach and per-client, not
 * per-table, so a row total says nothing about whether the slowest page is
 * represented. A saturated coach is the shape that actually hurts: a FULL
 * roster where every client carries the COMPLETE window at high engagement —
 * no short tenures, no churn cutoff, no holiday gaps, no missing plan.
 *
 * `share` is unused (these clients are assigned, never drawn) and `churnAt` is
 * 1.0 so the engagement curve never truncates. This is deliberately more
 * engaged than `power`: `power` is the top of a realistic distribution, this is
 * the ceiling the query must survive.
 */
export const SATURATED_ARCHETYPE: Archetype = {
  key: "saturated",
  share: 0,
  logDensity: 1.0,
  sessionCompletion: 0.97,
  checkInRate: 1.0,
  churnAt: 1.0,
  setDetail: 1.0,
};

/** Coach tiers. The same power law applies across coaches and within each roster. */
export type CoachTier = "full" | "moderate" | "dormant";

export const COACH_TIERS: readonly (readonly [CoachTier, number])[] = [
  ["full", 0.10],
  ["moderate", 0.40],
  ["dormant", 0.50],
];

/**
 * Bias an archetype draw by the coach's tier — a dormant coach's roster is
 * mostly lapsed clients, a full roster mostly engaged ones. This is what makes
 * the skew two-dimensional instead of a flat mixture.
 */
export function drawArchetype(tier: CoachTier, rng: Rng): Archetype {
  const bias: Record<CoachTier, number[]> = {
    // multipliers applied to the base shares, per archetype in ARCHETYPES order
    full: [3.0, 1.6, 0.5, 0.2, 0.05],
    moderate: [1.0, 1.0, 1.0, 1.0, 1.0],
    dormant: [0.15, 0.5, 1.4, 2.2, 3.0],
  };
  const weights = ARCHETYPES.map(
    (a, i) => [a, a.share * bias[tier][i]] as const
  );
  return rng.weighted(weights);
}

// ------------------------------------------------------- engagement curve

/**
 * Whether a client logs on a given day.
 *
 * Combines four effects that all show up in real data:
 *  - **Onboarding spike.** Heavy logging in the first 2-3 weeks, tailing off.
 *  - **Churn.** Past `churnAt` of their tenure the client stops entirely.
 *  - **Weekend dip.** Weekends are consistently thinner.
 *  - **Holiday breaks.** A couple of multi-day gaps per client.
 */
export function logsOnDay(
  archetype: Archetype,
  dayIndex: number,
  tenureDays: number,
  iso: string,
  breaks: readonly (readonly [number, number])[],
  rng: Rng
): boolean {
  if (archetype.logDensity === 0) return false;
  if (dayIndex >= tenureDays * archetype.churnAt) return false;
  for (const [start, end] of breaks) {
    if (dayIndex >= start && dayIndex < end) return false;
  }

  // logDensity 1.0 means "every eligible day", not "1.0 before modifiers". The
  // saturated cohort exists to be the densest client in the dataset, and the
  // novelty/attrition/weekend multipliers below would silently thin it to ~0.75
  // on weekdays and ~0.49 on weekends — leaving the worst case unrepresented.
  if (archetype.logDensity >= 1) return true;

  // Novelty multiplier: ~1.35x on day 0 decaying to 1.0 over ~21 days.
  const novelty = 1 + 0.35 * Math.exp(-dayIndex / 10);
  // Slow attrition across the whole window, independent of hard churn.
  const attrition = 1 - 0.25 * (dayIndex / Math.max(tenureDays, 1));
  const weekend = isWeekend(iso) ? 0.65 : 1;

  return rng.bool(Math.min(0.99, archetype.logDensity * novelty * attrition * weekend));
}

/** One or two multi-day breaks per client (holiday, illness). */
export function pickBreaks(tenureDays: number, rng: Rng): (readonly [number, number])[] {
  const count = rng.weighted([[0, 0.25], [1, 0.5], [2, 0.25]] as const);
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < count; i++) {
    const len = rng.int(3, 11);
    const start = rng.int(0, Math.max(1, tenureDays - len));
    out.push([start, start + len] as const);
  }
  return out;
}

/** Tenure: some clients have the full window, some were added two weeks ago. */
export function pickTenure(windowDays: number, rng: Rng): number {
  return rng.weighted([
    [windowDays, 0.40],
    [rng.int(Math.floor(windowDays * 0.6), windowDays - 1), 0.25],
    [rng.int(Math.floor(windowDays * 0.3), Math.floor(windowDays * 0.6)), 0.20],
    [rng.int(30, Math.floor(windowDays * 0.3)), 0.10],
    [rng.int(7, 29), 0.05],
  ] as const);
}

// ------------------------------------------------------------- hour profiles

/** Wellness is logged in the morning or the evening, rarely midday. */
export function wellnessHour(rng: Rng): number {
  return rng.weighted([[7, 3], [8, 4], [9, 2], [20, 3], [21, 4], [22, 2]] as const);
}

/** Nutrition totals are finalised late — after the last meal. */
export function nutritionHour(rng: Rng): number {
  return rng.weighted([[19, 2], [20, 4], [21, 4], [22, 3], [23, 1]] as const);
}

/** Sessions are weekday evenings, with a weekend-morning cluster. */
export function sessionHour(iso: string, rng: Rng): number {
  if (isWeekend(iso)) {
    return rng.weighted([[9, 4], [10, 5], [11, 3], [16, 2], [17, 2]] as const);
  }
  return rng.weighted([[6, 2], [7, 3], [12, 1], [17, 4], [18, 6], [19, 5], [20, 3]] as const);
}

/** Check-ins land on the client's check-in day, usually in the evening. */
export function checkInHour(rng: Rng): number {
  return rng.weighted([[9, 2], [12, 1], [18, 3], [19, 4], [20, 4], [21, 2]] as const);
}

// ------------------------------------------------------------------ text
//
// Row size and TOAST behaviour matter to the benchmark result, so text columns
// carry real sentences of plausible length rather than "test123". check_ins in
// particular measures 764 bytes/row today with these columns mostly NULL.

const NOTE_OPENERS = [
  "Form held up well through the working sets",
  "Struggled with the last two sets today",
  "Energy was noticeably better than last week",
  "Reported some tightness in the left shoulder",
  "Hit a comfortable PB on the main lift",
  "Sleep has been poor all week and it showed",
  "Much more consistent with the accessory work",
  "Bar speed dropped off sharply on the final set",
];

const NOTE_MIDDLES = [
  "so we kept the load where it was rather than pushing",
  "and the tempo was cleaner than the previous block",
  "though the warm-up took longer than usual to feel right",
  "which is a good sign going into the deload",
  "but recovery between sets was still too long",
  "and they asked to swap the accessory movement",
];

const NOTE_CLOSERS = [
  "Worth revisiting the setup cue next session.",
  "Happy to progress the load next week if this holds.",
  "Keeping volume flat until sleep improves.",
  "Flagged it for the next check-in review.",
  "No changes needed to the programme for now.",
  "Will drop a set if fatigue carries into next week.",
];

export function coachNote(rng: Rng): string {
  const sentences = rng.int(1, 3);
  const parts: string[] = [];
  for (let i = 0; i < sentences; i++) {
    parts.push(
      `${rng.pick(NOTE_OPENERS)} ${rng.pick(NOTE_MIDDLES)}. ${rng.pick(NOTE_CLOSERS)}`
    );
  }
  return parts.join(" ");
}

const CHECKIN_WINS = [
  "Got all four sessions in despite a busy work week",
  "Finally hit bodyweight on the bench for reps",
  "Stuck to the calorie target every day except Saturday",
  "Sleep averaged over seven hours for the first time in a while",
  "Managed to prep meals ahead on Sunday which made the week easier",
];

const CHECKIN_STRUGGLES = [
  "Weekends are still where the nutrition falls apart",
  "Struggling to get going in the mornings",
  "The evening sessions are hard to fit around work",
  "Appetite has been low so hitting protein is a grind",
  "Travelled midweek and missed two sessions",
];

export function checkInResponse(rng: Rng): string {
  return `${rng.pick(CHECKIN_WINS)}. ${rng.pick(CHECKIN_STRUGGLES)}. ${rng.pick(NOTE_CLOSERS)}`;
}

/**
 * The closed `DietType` union from types/check-in.ts.
 *
 * Not a free-text field: `calculateDailyMacros` indexes `dietSplits[dietType]`
 * and immediately reads `split.fat`, so an unrecognised value is a TypeError,
 * not a cosmetic mismatch. `nutrition_plans.diet_type` is a plain text column
 * with no CHECK, so the database will not catch a typo here.
 */
export const DIET_TYPES = ["balanced", "high_carb", "low_carb", "keto"] as const;

/**
 * AI review text — deliberately the longest string the seed writes. At ~700-1200
 * chars it approaches the 2KB TOAST threshold on check_ins, which is exactly the
 * row-size behaviour the benchmark needs to exercise.
 *
 * Only `check_ins.ai_summary` is text. `ai_insights` and `ai_recommendations`
 * are jsonb — see aiInsightsV3 / aiRecommendations below.
 */
export function aiReviewText(rng: Rng): string {
  const paras = [
    `Adherence over the period was ${rng.int(55, 98)}% against the prescribed schedule. ${rng.pick(CHECKIN_WINS)}, which is consistent with the trend over the previous two check-ins.`,
    `Training volume held broadly flat week on week. ${rng.pick(NOTE_OPENERS)} ${rng.pick(NOTE_MIDDLES)}, and the reported RPE on the main lifts sat around ${rng.int(6, 9)}.`,
    `Nutrition was on target ${rng.int(2, 7)} days of seven. ${rng.pick(CHECKIN_STRUGGLES)}, which is the main lever available before adjusting the calorie floor.`,
    `Recommendation: ${rng.pick(NOTE_CLOSERS).toLowerCase().replace(/\.$/, "")}, and revisit the progression scheme if the same pattern shows up next period.`,
  ];
  return paras.join("\n\n");
}

const WATCH_TYPES = ["win", "risk", "trend", "flag"] as const;

const WATCH_TEXTS = [
  "Protein intake has been under target four days running",
  "Bodyweight has stalled for two consecutive check-ins",
  "Session completion improved sharply this period",
  "Sleep scores trending down since the travel week",
  "Reported soreness is elevated after the volume increase",
  "Nutrition adherence is strongest on training days",
];

const THEME_TEXTS = [
  "consistency", "recovery", "protein intake", "training volume",
  "weekend adherence", "sleep quality", "progressive overload",
];

const ACTION_TEXTS = [
  "Drop one accessory set until sleep normalises",
  "Ask about weekend meal planning at the next call",
  "Progress the main lift by 2.5kg next block",
  "Review the check-in photos before adjusting calories",
  "Hold calories flat for another week and reassess",
];

/**
 * `check_ins.ai_insights` — jsonb, NOT text.
 *
 * The live column is jsonb and `updateCheckInAISummary` writes the v3 shape
 * `{_version: 3, watchItems, themes, coachActions}`. Writing a prose string
 * here stores a jsonb *string scalar*, which still inserts cleanly but makes
 * `lib/mappers.ts` hand every reader a string where it expects an object.
 */
export function aiInsightsV3(rng: Rng): Record<string, unknown> {
  return {
    _version: 3,
    watchItems: Array.from({ length: rng.int(2, 4) }, () => ({
      type: rng.pick(WATCH_TYPES),
      text: rng.pick(WATCH_TEXTS),
    })),
    themes: rng.shuffle(THEME_TEXTS).slice(0, rng.int(2, 4)),
    coachActions: aiRecommendations(rng),
  };
}

/**
 * `check_ins.ai_recommendations` — jsonb, and deliberately the same
 * `{ priority, text }[]` shape as the v3 `coachActions`, which is what keeps
 * pre-v3 readers resolving (see services/check-in-service.ts).
 */
export function aiRecommendations(rng: Rng): Record<string, unknown>[] {
  return Array.from({ length: rng.int(1, 3) }, () => ({
    priority: rng.weighted([["high", 2], ["medium", 4], ["low", 3]] as const),
    text: rng.pick(ACTION_TEXTS),
  }));
}

/**
 * `nutrition_logs.nutrition_adherence` is a STATUS string, not a percentage.
 *
 * The column is plain text with no CHECK, so a numeric percentage inserts
 * silently as "87" and poisons every read path. Live values are only
 * hit/partial/missed. The thresholds are imported rather than restated because
 * they are ABSOLUTE CALORIES (50 / 200), not the percentages they look like —
 * a locally-guessed percentage would classify most rows differently and the
 * database would not object.
 */
export function nutritionAdherenceStatus(consumed: number, target: number): "hit" | "partial" | "missed" {
  const difference = Math.abs(consumed - target);
  if (difference <= NUTRITION_ADHERENCE_HIT_THRESHOLD) return "hit";
  if (difference <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD) return "partial";
  return "missed";
}

// ---------------------------------------------------------------- catalogue

/** Compound-first exercise pool, so `category='compound'` progression paths have data. */
export const EXERCISE_POOL: readonly { name: string; compound: boolean; base: number }[] = [
  { name: "Barbell Back Squat", compound: true, base: 100 },
  { name: "Barbell Bench Press", compound: true, base: 80 },
  { name: "Conventional Deadlift", compound: true, base: 130 },
  { name: "Overhead Press", compound: true, base: 50 },
  { name: "Barbell Row", compound: true, base: 70 },
  { name: "Front Squat", compound: true, base: 80 },
  { name: "Romanian Deadlift", compound: true, base: 90 },
  { name: "Weighted Pull-Up", compound: true, base: 20 },
  { name: "Dumbbell Bench Press", compound: false, base: 30 },
  { name: "Lat Pulldown", compound: false, base: 55 },
  { name: "Leg Press", compound: false, base: 160 },
  { name: "Seated Cable Row", compound: false, base: 60 },
  { name: "Dumbbell Lateral Raise", compound: false, base: 12 },
  { name: "Barbell Curl", compound: false, base: 30 },
  { name: "Triceps Rope Pushdown", compound: false, base: 35 },
  { name: "Leg Curl", compound: false, base: 45 },
  { name: "Walking Lunge", compound: false, base: 24 },
  { name: "Cable Fly", compound: false, base: 20 },
];

export const SPLIT_TYPES = ["push_pull_legs", "upper_lower", "full_body", "bro_split"] as const;

export const SESSION_NAMES = [
  "Push Day", "Pull Day", "Leg Day", "Upper Body", "Lower Body",
  "Full Body A", "Full Body B", "Chest & Triceps", "Back & Biceps", "Shoulders & Arms",
] as const;

export const HABIT_NAMES = [
  "10,000 steps", "Drink 3L water", "8 hours sleep", "Protein at every meal",
  "10 min mobility", "No alcohol", "Log everything",
] as const;

/**
 * IANA zones only — `clients.timezone` and `coaches.timezone` both carry
 * CHECK (timezone ~ '^[A-Za-z_+\-/]+$'), which has no digit class, so
 * `Etc/GMT+5` and friends are rejected outright.
 */
export const TIMEZONES = [
  "UTC", "Europe/London", "Europe/Dublin", "Europe/Madrid",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney",
] as const;
