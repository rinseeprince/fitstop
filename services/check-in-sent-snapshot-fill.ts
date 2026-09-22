import { supabaseAdmin } from "./supabase-admin";
import { getClientById } from "./client-service";
import { listClientGoals } from "./client-goals-service";
import {
  getMeasurementsForCheckIns,
  getReadingsAsOf,
  getReadingsOnDay,
} from "./measurements-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getClientAdherenceForRange } from "./client-adherence-service";
import { getNutritionPeriod } from "./nutrition-period-service";
import { resolveCheckInReportingPeriod } from "./check-in-details-service";
import {
  composeNutritionPlan,
  composePeriod,
  composeReadings,
} from "./check-in-sent-snapshot-service";
import { checkInTrend, composeGoalSection } from "@/lib/check-in/sent-snapshot-goal";
import {
  parseSentSnapshot,
  SENT_SNAPSHOT_VERSION,
  type SentSnapshot,
} from "@/lib/check-in/sent-snapshot";
import { goalAsOf, goalOnDay } from "@/lib/goals/goal-timeline";
import { expandDateRange, getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { mapCheckInRow } from "@/lib/mappers";
import { readPeriodSnapshot } from "@/lib/check-in/period-snapshot";
import type { CheckInRow } from "@/lib/database-helpers";

/**
 * Saving the copy of a check-in that has none: one sent before copies existed
 * (migration 195), or one a seed script inserted directly. It freezes what the
 * check-in's review shows NOW — the same reads the review made on the day it
 * started reading the copy instead (owner, 2026-09-22: existing check-ins keep
 * exactly what they show). The database lets an empty copy be filled once and
 * refuses any change after, so this only ever writes where there is none.
 */

/** The check-ins the trend runs over: the judged one and the nine before it. */
const TREND_CHECK_INS = 10;

/** The questions a check-in answered, in the wording the review shows today. */
async function readAnsweredQuestions(
  checkInId: string
): Promise<{ questionId: string; prompt: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("check_in_answers")
    .select("question_id, created_at, check_in_questions ( prompt )")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to read the check-in's answers: ${error.message}`);
  type AnswerRow = { question_id: string; check_in_questions: { prompt: string } | null };
  return ((data ?? []) as AnswerRow[]).map((row) => ({
    questionId: row.question_id,
    prompt: row.check_in_questions?.prompt ?? "Question",
  }));
}

/** The ten check-ins up to and including one, newest first. */
async function readTrendUpTo(
  clientId: string,
  at: string
): Promise<{ id: string; createdAt: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("id, created_at")
    .eq("client_id", clientId)
    .lte("created_at", at)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TREND_CHECK_INS);
  if (error) throw new Error(`Failed to read the check-ins up to this one: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, createdAt: row.created_at ?? at }));
}

/**
 * The copy of a check-in sent before copies existed: what its review shows
 * now. Its readings are its own rows in the client's log as they stand today;
 * its goal section is the review's computation on its day; its week is the
 * review's figures for the period — the habits as they stand, the days logged,
 * and the food against each day's target: the rows the check-in froze at Send
 * when they cover exactly its week (a check-in as it was sent is the whole
 * point, and those rows are that week's targets as they stood), else the
 * targets the review shows now; its questions keep the wording they have today.
 */
export async function buildSentSnapshotAsShown(row: CheckInRow): Promise<SentSnapshot> {
  const checkIn = mapCheckInRow(row);
  const client = await getClientById(row.client_id, true);
  if (!client) throw new Error(`Client ${row.client_id} not found`);

  const at = checkIn.createdAt;
  const day = getTodayDateStringInTimezone(client.timezone, new Date(at));

  const [reported, goals, readingsThen, plan, trendCheckIns, period, questions] = await Promise.all([
    getMeasurementsForCheckIns([row.id]).then((readings) => readings.get(row.id) ?? {}),
    listClientGoals(row.client_id),
    getReadingsAsOf(row.client_id, day, row.id),
    getNutritionPlanForDate(row.client_id, day),
    readTrendUpTo(row.client_id, at),
    resolveCheckInReportingPeriod(checkIn),
    readAnsweredQuestions(row.id),
  ]);

  const judged = goalOnDay(goals, day);
  const noReadings: Awaited<ReturnType<typeof getReadingsOnDay>> = {};
  // The food rows frozen at Send — only when they are the week's own days, so
  // the copy's rows and its dates can never describe two different weeks.
  const sentFood = readPeriodSnapshot(row.period_snapshot)?.nutrition ?? null;
  const weekDays = period ? expandDateRange(period.periodStart, period.periodEnd) : [];
  const frozenFood =
    sentFood &&
    sentFood.length === weekDays.length &&
    sentFood.every((foodDay, i) => foodDay.date === weekDays[i])
      ? sentFood
      : null;
  const [goalStartRead, trendReadings, adherence, nutrition] = await Promise.all([
    judged ? getReadingsOnDay(row.client_id, judged.startsOn) : Promise.resolve(noReadings),
    getMeasurementsForCheckIns(trendCheckIns.map((trendCheckIn) => trendCheckIn.id)),
    period
      ? getClientAdherenceForRange(row.client_id, period.periodStart, period.periodEnd, period.periodEnd)
      : Promise.resolve(null),
    period && !frozenFood
      ? getNutritionPeriod(row.client_id, period.periodStart, period.periodEnd)
      : Promise.resolve(null),
  ]);

  const standing = { weight: readingsThen.weight?.value, bodyFat: readingsThen.bodyFat?.value };
  const goalSection = composeGoalSection({
    goal: judged ? goalAsOf(judged, day) : null,
    instant: new Date(at),
    timezone: client.timezone,
    standing,
    goalStart: { weight: goalStartRead.weight?.value, bodyFat: goalStartRead.bodyFat?.value },
    baseline: { weight: client.startingWeight, bodyFat: client.startingBodyFatPercentage },
    trend: checkInTrend(
      trendCheckIns.map((trendCheckIn) => ({
        createdAt: trendCheckIn.createdAt,
        weight: trendReadings.get(trendCheckIn.id)?.weight,
        bodyFatPercentage: trendReadings.get(trendCheckIn.id)?.bodyFat,
      }))
    ),
  });

  return parseSentSnapshot({
    version: SENT_SNAPSHOT_VERSION,
    day,
    readings: composeReadings(reported),
    standing: { weight: standing.weight ?? null, bodyFat: standing.bodyFat ?? null },
    ...goalSection,
    nutritionPlan: composeNutritionPlan(plan),
    period: composePeriod(adherence, frozenFood ?? nutrition?.days ?? null),
    questions,
  });
}

/** Every check-in with no copy yet — of the given clients, else of everyone — by id. */
async function listCheckInsWithoutCopy(clientIds?: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  // Keyset by id: the rows being filled leave the "no copy" set as the walk
  // goes, which an offset page would skip over.
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    let query = supabaseAdmin
      .from("check_ins")
      .select("id")
      .is("sent_snapshot", null)
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(1000);
    if (clientIds) query = query.in("client_id", [...clientIds]);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list check-ins without a copy: ${error.message}`);
    const page = (data ?? []).map((row) => row.id);
    ids.push(...page);
    if (page.length < 1000) return ids;
    after = page[page.length - 1];
  }
}

type FillResult = {
  filled: number;
  /** Filled by someone else between the list and the write. */
  alreadyFilled: number;
  failed: { id: string; error: string }[];
};

/**
 * Saves a copy for every check-in that has none — of the given clients, else
 * of everyone. The write only lands where the copy is still empty, so a run
 * repeated, or racing a Send, never overwrites one (and the database would
 * refuse it). A check-in that fails is reported and left empty for a rerun.
 */
export async function fillSentSnapshots(
  options: { clientIds?: readonly string[]; concurrency?: number } = {}
): Promise<FillResult> {
  if (options.clientIds && options.clientIds.length === 0) {
    return { filled: 0, alreadyFilled: 0, failed: [] };
  }
  const ids = await listCheckInsWithoutCopy(options.clientIds);
  const result: FillResult = { filled: 0, alreadyFilled: 0, failed: [] };

  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const { data: row, error } = await supabaseAdmin
          .from("check_ins")
          .select("*")
          .eq("id", id)
          .single();
        if (error || !row) throw new Error(error?.message ?? "Check-in not found");
        if (row.sent_snapshot != null) {
          result.alreadyFilled += 1;
          continue;
        }
        const snapshot = await buildSentSnapshotAsShown(row);
        const { data: written, error: writeError } = await supabaseAdmin
          .from("check_ins")
          .update({ sent_snapshot: snapshot })
          .eq("id", id)
          .is("sent_snapshot", null)
          .select("id");
        if (writeError) throw new Error(writeError.message);
        if ((written ?? []).length === 0) result.alreadyFilled += 1;
        else result.filled += 1;
      } catch (error) {
        result.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 8) }, worker));
  return result;
}
