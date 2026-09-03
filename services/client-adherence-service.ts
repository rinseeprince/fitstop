import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { HABIT_DROPOFF_THRESHOLD_PERCENT } from "@/lib/constants";
import {
  CLIENT_MEASUREMENT_SOURCE,
  hasNutritionEntry,
  hasWellnessReading,
  isTrainingLogStatus,
  loggedDays,
} from "@/lib/logged-days";
import type { AdherenceSummary, DotState } from "@/types/coach-overview";

/**
 * The Overview's three-rail adherence card (AdherenceSummary contract).
 * Reuses shipped semantics only — training from training_events.status,
 * nutrition from the persisted nutrition_logs.nutrition_adherence, habits from
 * the weekly-service eligibility rule (active habits with effective_date ≤ the
 * day) — no new adherence math is invented here.
 */

/**
 * One dot per date from that date's event statuses. The classification table
 * assumes one session per day; multi-event days collapse deterministically:
 * all completed → complete, any progress → partial, any missed/skipped →
 * missed, else (still scheduled, date ≤ today) → no_log.
 */
export function classifyTrainingDay(statuses: string[]): DotState {
  if (!statuses.length) return "none";
  if (statuses.every((status) => status === "completed")) return "complete";
  if (statuses.some((status) => status === "completed" || status === "partial")) return "partial";
  if (statuses.some((status) => status === "missed" || status === "skipped")) return "missed";
  return "no_log";
}

export function classifyNutritionDay(adherence: string | null | undefined): DotState {
  if (adherence === "hit") return "complete";
  if (adherence === "partial") return "partial";
  if (adherence === "missed") return "missed";
  return "no_log";
}

/**
 * Per-day habit completion: 100% → complete, partial progress → partial, zero
 * on a LOGGED day (the client logged something that day — the derived
 * definition, lib/logged-days.ts) → missed, zero with no log of any kind →
 * no_log. Days with no eligible habit carry no signal.
 */
export function classifyHabitDay(input: {
  eligible: number;
  completed: number;
  logged: boolean;
}): { dot: DotState; pct: number | null } {
  if (input.eligible === 0) return { dot: "no_log", pct: null };
  const pct = Math.round((input.completed / input.eligible) * 100);
  if (pct === 100) return { dot: "complete", pct };
  if (pct > 0) return { dot: "partial", pct };
  return { dot: input.logged ? "missed" : "no_log", pct };
}

export type AdherenceSourceRows = {
  dates: string[];
  trainingEvents: { date: string; status: string }[];
  nutritionLogs: {
    date: string;
    nutrition_adherence: string | null;
    calories_consumed: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  }[];
  habits: { id: string; name: string; effective_date: string }[];
  habitLogs: { date: string; daily_habit_id: string; completed: boolean }[];
  wellnessLogs: {
    date: string;
    mood: number | null;
    energy: number | null;
    sleep: number | null;
    stress: number | null;
    soreness: number | null;
  }[];
  /** Days the client logged a body measurement themselves (`source = 'client_log'`). */
  clientLogDates: string[];
};

/** Pure assembly over fetched rows — unit-tested against fixtures. */
export function buildAdherenceSummary(rows: AdherenceSourceRows): AdherenceSummary {
  const { dates } = rows;

  // The days the client logged anything, by the one definition — the habits
  // rail reads it for Missed versus No log, and the check-in review's header
  // prints it. Assembled from the rows this read already holds.
  const loggedDates = loggedDays(
    {
      wellness: rows.wellnessLogs.filter(hasWellnessReading).map((log) => log.date),
      nutrition: rows.nutritionLogs
        .filter((log) =>
          hasNutritionEntry({
            caloriesConsumed: log.calories_consumed,
            proteinG: log.protein_g,
            carbsG: log.carbs_g,
            fatG: log.fat_g,
          })
        )
        .map((log) => log.date),
      habits: rows.habitLogs.map((log) => log.date),
      training: rows.trainingEvents
        .filter((event) => isTrainingLogStatus(event.status))
        .map((event) => event.date),
      measurements: rows.clientLogDates,
    },
    { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" }
  );

  // Training
  const eventsByDate = new Map<string, string[]>();
  for (const event of rows.trainingEvents) {
    const list = eventsByDate.get(event.date) ?? [];
    list.push(event.status);
    eventsByDate.set(event.date, list);
  }
  const trainingRail = dates.map((date) => classifyTrainingDay(eventsByDate.get(date) ?? []));
  const planned = rows.trainingEvents.length;
  const completed = rows.trainingEvents.filter((event) => event.status === "completed").length;
  // Full completions only, matching the Training-tab hero — partial shows on
  // the dot but not in the numerator (deliberate).
  const trainingPct = planned > 0 ? Math.round((completed / planned) * 100) : null;

  // Nutrition
  const adherenceByDate = new Map<string, string | null>();
  for (const log of rows.nutritionLogs) {
    adherenceByDate.set(log.date, log.nutrition_adherence);
  }
  const nutritionRail = dates.map((date) => classifyNutritionDay(adherenceByDate.get(date)));
  // Days with a nutrition classification — the rail's own, narrower count,
  // not the logged-day set above.
  const nutritionLoggedDays = nutritionRail.filter((dot) => dot !== "no_log").length;
  const onTarget = nutritionRail.filter((dot) => dot === "complete").length;
  const nutritionPct = nutritionLoggedDays > 0 ? Math.round((onTarget / dates.length) * 100) : null;

  // Habits
  const knownHabitIds = new Set(rows.habits.map((habit) => habit.id));
  const completedByDate = new Map<string, Set<string>>();
  for (const log of rows.habitLogs) {
    if (!log.completed || !knownHabitIds.has(log.daily_habit_id)) continue;
    const set = completedByDate.get(log.date) ?? new Set<string>();
    set.add(log.daily_habit_id);
    completedByDate.set(log.date, set);
  }
  const loggedDateSet = new Set(loggedDates);

  const habitsRail: DotState[] = [];
  const dayPcts: number[] = [];
  for (const date of dates) {
    const eligibleHabits = rows.habits.filter((habit) => habit.effective_date <= date);
    const completedSet = completedByDate.get(date);
    const completedCount = eligibleHabits.filter((habit) => completedSet?.has(habit.id)).length;
    const { dot, pct } = classifyHabitDay({
      eligible: eligibleHabits.length,
      completed: completedCount,
      logged: loggedDateSet.has(date),
    });
    habitsRail.push(dot);
    if (pct !== null) dayPcts.push(pct);
  }
  const avgPct = dayPcts.length
    ? Math.round(dayPcts.reduce((sum, pct) => sum + pct, 0) / dayPcts.length)
    : null;
  const daysBelow50 = dayPcts.filter((pct) => pct < HABIT_DROPOFF_THRESHOLD_PERCENT).length;

  // The same rows again, cut the other way: per habit rather than per day.
  //
  // Built from the HABIT list, not from the logs, so a habit the client never
  // touched in the window reads 0% instead of disappearing — `logHabit` writes
  // a row only when they act, so "no rows" and "no habit" look identical from
  // the log side. It is also why this rides here rather than on /habits/logs.
  const perHabit = rows.habits.map((habit) => {
    const rail = dates.map((date) => {
      // Before its effective date the habit did not exist: null, never false.
      // A habit added on Wednesday has not "missed" Monday and Tuesday.
      if (habit.effective_date > date) return null;
      return completedByDate.get(date)?.has(habit.id) ?? false;
    });
    const eligibleDays = rail.filter((day) => day !== null).length;
    const completedDays = rail.filter((day) => day === true).length;
    return {
      id: habit.id,
      name: habit.name,
      eligibleDays,
      completedDays,
      pct: eligibleDays > 0 ? Math.round((completedDays / eligibleDays) * 100) : null,
      rail,
    };
  });

  return {
    dates,
    loggedDates,
    training: { rail: trainingRail, completed, planned, pct: trainingPct },
    nutrition: { rail: nutritionRail, onTarget, loggedDays: nutritionLoggedDays, pct: nutritionPct },
    habits: { rail: habitsRail, avgPct, daysBelow50, perHabit },
  };
}

/**
 * The summary for an EXPLICIT window — the check-in review's case, where the
 * window is the period a check-in reported on and usually ended in the past.
 *
 * Every read is bounded by `endDate`, not by today: bounding a historical week
 * at today would pull in rows the check-in never reported on, and the caller
 * would be describing a different week from the one on screen.
 *
 * `dates` is materialised here and returned on the summary, so a renderer takes
 * its denominator from the same array the rails are indexed against.
 */
export const getClientAdherenceForRange = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<AdherenceSummary> => {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDaysToDateString(date, 1)) {
    dates.push(date);
  }

  const [events, nutritionLogs, habits, habitLogs, wellnessLogs, clientLogs] = await Promise.all([
    supabaseAdmin
      .from("training_events")
      .select("date, status")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate),
    supabaseAdmin
      .from("nutrition_logs")
      .select("date, nutrition_adherence, calories_consumed, protein_g, carbs_g, fat_g")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate),
    supabaseAdmin
      .from("daily_habits")
      .select("id, name, effective_date")
      .eq("client_id", clientId)
      .eq("is_active", true),
    supabaseAdmin
      .from("daily_habit_logs")
      .select("date, daily_habit_id, completed")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate),
    supabaseAdmin
      .from("wellness_logs")
      .select("date, mood, energy, sleep, stress, soreness")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate),
    // The client's own measurement logs — empty until the client app can log
    // a weight, read now so the logged-day definition cannot lose its fifth
    // source the day it can. Every calculation reads the live view.
    supabaseAdmin
      .from("client_measurements_live")
      .select("recorded_on")
      .eq("client_id", clientId)
      .eq("source", CLIENT_MEASUREMENT_SOURCE)
      .gte("recorded_on", startDate)
      .lte("recorded_on", endDate),
  ]);

  for (const result of [events, nutritionLogs, habits, habitLogs, wellnessLogs, clientLogs]) {
    if (result.error) {
      console.error("Failed to read adherence source rows:", result.error);
      throw new Error("Failed to read adherence data");
    }
  }

  return buildAdherenceSummary({
    dates,
    trainingEvents: events.data ?? [],
    nutritionLogs: nutritionLogs.data ?? [],
    habits: habits.data ?? [],
    habitLogs: habitLogs.data ?? [],
    wellnessLogs: wellnessLogs.data ?? [],
    clientLogDates: (clientLogs.data ?? []).flatMap((row) =>
      row.recorded_on ? [row.recorded_on] : []
    ),
  });
};

/**
 * The Overview's rolling window: the last `days` days ending client-local
 * today. A thin resolver over `getClientAdherenceForRange` — the window is the
 * only thing that differs between the two surfaces, so the reads and the
 * assembly stay in one place.
 */
export const getClientAdherence = async (
  clientId: string,
  days: number
): Promise<AdherenceSummary> => {
  const today = await getClientTodayString(clientId);
  return getClientAdherenceForRange(clientId, addDaysToDateString(today, -(days - 1)), today);
};
