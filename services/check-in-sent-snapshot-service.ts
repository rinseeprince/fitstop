import { supabaseAdmin } from "./supabase-admin";
import { listClientGoals } from "./client-goals-service";
import {
  getBaseline,
  getReadingsAsOf,
  getReadingsOnDay,
  type StandingReading,
} from "./measurements-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getClientAdherenceForRange } from "./client-adherence-service";
import { goalAsOf, goalOnDay } from "@/lib/goals/goal-timeline";
import {
  checkInTrend,
  composeGoalSection,
  withSentReading,
  type DatedReading,
  type TrendCheckIn,
} from "@/lib/check-in/sent-snapshot-goal";
import {
  parseSentSnapshot,
  readSentSnapshot,
  SENT_SNAPSHOT_VERSION,
  type SentSnapshot,
} from "@/lib/check-in/sent-snapshot";
import { MEASUREMENT_KEYS, type MeasurementValues } from "@/lib/measurements/keys";
import type { Client } from "@/types/check-in";
import type { AdherenceSummary } from "@/types/coach-overview";
import type { NutritionDay } from "@/types/schedule";

/**
 * The copy a check-in saves when the client sends it (migration 195;
 * lib/check-in/sent-snapshot.ts): computed here, before the check-in's
 * INSERT, and written in it. Owner ruling 2026-09-22: a sent check-in is
 * frozen in time — nothing a coach does afterwards moves it.
 *
 * Its goal section is the review's computation on the check-in's day, done
 * once: the goal in force that day with that day's deadline, the reading as of
 * that day, the client's reading on the goal's start day, their baseline, the
 * trend over the ten check-ins up to this one and the days to the deadline —
 * through the one kernel (`composeGoalSection` → `deriveGoalProgress`). The
 * check-in's own readings are written just AFTER its row, so every read that
 * would have seen them counts the reported values instead (`withSentReading`,
 * and this check-in at the head of the trend): the copy is what a review read
 * straight after the Send would have shown.
 */

/** The check-ins the trend runs over: this one and the nine before it. */
const TREND_CHECK_INS = 10;

type GoalMetric = "weight" | "bodyFat";

const dated = (reading: StandingReading | undefined): DatedReading | undefined =>
  reading ? { value: reading.value, date: reading.date } : undefined;

/** The questions answered, in the wording each has now — at Send, the wording the client saw. */
async function readQuestionWording(
  questionIds: readonly string[]
): Promise<Map<string, string>> {
  const wording = new Map<string, string>();
  if (questionIds.length === 0) return wording;
  const { data, error } = await supabaseAdmin
    .from("check_in_questions")
    .select("id, prompt")
    .in("id", [...questionIds]);
  if (error) {
    throw new Error(`Failed to read the questions' wording: ${error.message}`);
  }
  for (const row of data ?? []) wording.set(row.id, row.prompt);
  return wording;
}

/**
 * The week, as it stands: the days, the days the client logged, the food
 * against each day's target and the habits. Null when the week cannot be
 * resolved, as the review has always shown it.
 */
export function composePeriod(
  adherence: Pick<AdherenceSummary, "dates" | "loggedDates" | "habits"> | null,
  nutritionDays: NutritionDay[] | null
): SentSnapshot["period"] {
  if (!adherence || !nutritionDays) return null;
  return {
    dates: adherence.dates,
    loggedDates: adherence.loggedDates,
    nutrition: nutritionDays,
    habits: adherence.habits,
  };
}

/** The nutrition plan covering the check-in's day — what the weight-drift note compares with. */
export function composeNutritionPlan(
  plan: { base_weight_kg: number | null; effective_from: string } | null
): SentSnapshot["nutritionPlan"] {
  if (!plan) return null;
  return {
    baseWeightKg: plan.base_weight_kg == null ? null : Number(plan.base_weight_kg),
    effectiveFrom: plan.effective_from,
  };
}

/** Every reported reading, null where the form carried none. */
export function composeReadings(values: MeasurementValues): SentSnapshot["readings"] {
  return Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => [key, values[key] ?? null])
  ) as SentSnapshot["readings"];
}

/**
 * The nine check-ins before this one, newest first, with what each SENT: the
 * readings in their own saved copies, never the log's corrected rows — a trend
 * over reports is a trend over what was reported. A check-in without a copy
 * means the one-off fill has not run here, which would freeze a trend with a
 * hole in it for ever, so it throws instead.
 */
async function readTrendBefore(clientId: string, at: string): Promise<TrendCheckIn[]> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("id, created_at, sent_snapshot")
    .eq("client_id", clientId)
    .lte("created_at", at)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TREND_CHECK_INS - 1);
  if (error) {
    throw new Error(`Failed to read the check-ins before this one: ${error.message}`);
  }
  return (data ?? []).map((row) => {
    const saved = readSentSnapshot(row.sent_snapshot);
    if (!saved) {
      throw new Error(
        `Check-in ${row.id} has no saved copy — run scripts/fill-check-in-sent-snapshots.ts`
      );
    }
    return {
      createdAt: row.created_at ?? at,
      weight: saved.readings.weight ?? undefined,
      bodyFatPercentage: saved.readings.bodyFat ?? undefined,
    };
  });
}

/**
 * The copy of a check-in the client is sending now. Read before the INSERT;
 * validated before it returns (a copy that does not match its shape is a
 * defect, and saving it would freeze the defect).
 */
export async function buildSentSnapshotAtSend(input: {
  client: Pick<Client, "id" | "timezone" | "startDate">;
  /** The instant the check-in is saved at — written as its `created_at`. */
  at: Date;
  /** The check-in's day on the client's calendar. */
  day: string;
  /** What the form carries, canonical kg / cm / %. */
  reported: MeasurementValues;
  /** The week it reports on — the stored period — or null without one. */
  period: { start: string; end: string } | null;
  /** The week's food against each day's target: the rows the period snapshot freezes too. */
  nutritionDays: NutritionDay[] | null;
  /** The questions the client answered, whose wording the copy keeps. */
  answeredQuestionIds: string[];
}): Promise<SentSnapshot> {
  const { client, day, reported } = input;
  const at = input.at.toISOString();

  const [goals, asOf, baseline, plan, before, adherence, wording] = await Promise.all([
    listClientGoals(client.id),
    getReadingsAsOf(client.id, day),
    getBaseline(client.id),
    getNutritionPlanForDate(client.id, day),
    readTrendBefore(client.id, at),
    input.period
      ? // The week's own last day stands in for "today", as on the review.
        getClientAdherenceForRange(client.id, input.period.start, input.period.end, input.period.end)
      : Promise.resolve(null),
    readQuestionWording(input.answeredQuestionIds),
  ]);

  const judged = goalOnDay(goals, day);
  const goalStartRead = judged ? await getReadingsOnDay(client.id, judged.startsOn) : {};

  const sent = (metric: GoalMetric): DatedReading | undefined => {
    const value = reported[metric];
    return value != null ? { value, date: day } : undefined;
  };
  const pair = (read: (metric: GoalMetric) => number | undefined) => ({
    weight: read("weight"),
    bodyFat: read("bodyFat"),
  });

  // The reading as of the day: the check-in's own, else the newest before it.
  const standing = pair((metric) => reported[metric] ?? asOf[metric]?.value);
  const goalStart = judged
    ? pair((metric) => withSentReading(dated(goalStartRead[metric]), sent(metric), judged.startsOn)?.value)
    : {};
  const startDate = client.startDate;
  const baselineThen = startDate
    ? pair((metric) => withSentReading(dated(baseline[metric]), sent(metric), startDate)?.value)
    : {};

  const trend = checkInTrend([
    { createdAt: at, weight: reported.weight, bodyFatPercentage: reported.bodyFat },
    ...before,
  ]);

  const goalSection = composeGoalSection({
    goal: judged ? goalAsOf(judged, day) : null,
    instant: input.at,
    timezone: client.timezone,
    standing,
    goalStart,
    baseline: baselineThen,
    trend,
  });

  return parseSentSnapshot({
    version: SENT_SNAPSHOT_VERSION,
    day,
    readings: composeReadings(reported),
    standing: { weight: standing.weight ?? null, bodyFat: standing.bodyFat ?? null },
    ...goalSection,
    nutritionPlan: composeNutritionPlan(plan),
    period: composePeriod(adherence, input.nutritionDays),
    questions: input.answeredQuestionIds.map((questionId) => ({
      questionId,
      prompt: wording.get(questionId) ?? "Question",
    })),
  });
}
