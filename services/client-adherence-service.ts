import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { HABIT_DROPOFF_THRESHOLD_PERCENT } from "@/lib/constants";
import type {
  AdherenceSummary,
  DotState,
  NutritionAverage,
} from "@/types/coach-overview";

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
 * WITH a daily_logs spine row (the client engaged that day) → missed, zero
 * with no engagement → no_log. Days with no eligible habit carry no signal.
 */
export function classifyHabitDay(input: {
  eligible: number;
  completed: number;
  hasSpineRow: boolean;
}): { dot: DotState; pct: number | null } {
  if (input.eligible === 0) return { dot: "no_log", pct: null };
  const pct = Math.round((input.completed / input.eligible) * 100);
  if (pct === 100) return { dot: "complete", pct };
  if (pct > 0) return { dot: "partial", pct };
  return { dot: input.hasSpineRow ? "missed" : "no_log", pct };
}

/**
 * Mean intake vs the mean target that applied over the SAME days.
 *
 * Both halves come from `nutrition_logs`, which snapshots the day's target on
 * the row — so this is what the client was actually asked for at the time,
 * not today's plan applied backwards over a window a plan change may sit in
 * the middle of.
 *
 * A row missing either half is excluded from BOTH means rather than from one:
 * an average intake over nine days set against an average target over six is
 * a comparison of two different fortnights.
 */
function averagePair(
  rows: { actual: number | null; target: number | null }[]
): NutritionAverage {
  const paired = rows.filter(
    (row): row is { actual: number; target: number } =>
      row.actual != null && row.target != null
  );
  if (paired.length === 0) return null;

  const mean = (pick: (row: { actual: number; target: number }) => number) =>
    Math.round(paired.reduce((sum, row) => sum + pick(row), 0) / paired.length);

  return {
    actual: mean((row) => row.actual),
    target: mean((row) => row.target),
    days: paired.length,
  };
}

export type AdherenceSourceRows = {
  dates: string[];
  trainingEvents: { date: string; status: string }[];
  nutritionLogs: {
    date: string;
    nutrition_adherence: string | null;
    calories_consumed: number | null;
    protein_g: number | null;
    target_calories: number | null;
    target_protein_g: number | null;
  }[];
  habits: { id: string; name: string; effective_date: string }[];
  habitLogs: { date: string; daily_habit_id: string; completed: boolean }[];
  spineDates: string[];
};

/** Pure assembly over fetched rows — unit-tested against fixtures. */
export function buildAdherenceSummary(rows: AdherenceSourceRows): AdherenceSummary {
  const { dates } = rows;

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
  const loggedDays = nutritionRail.filter((dot) => dot !== "no_log").length;
  const onTarget = nutritionRail.filter((dot) => dot === "complete").length;
  const nutritionPct = loggedDays > 0 ? Math.round((onTarget / dates.length) * 100) : null;
  const calories = averagePair(
    rows.nutritionLogs.map((log) => ({
      actual: log.calories_consumed,
      target: log.target_calories,
    }))
  );
  const protein = averagePair(
    rows.nutritionLogs.map((log) => ({
      actual: log.protein_g,
      target: log.target_protein_g,
    }))
  );

  // Habits
  const knownHabitIds = new Set(rows.habits.map((habit) => habit.id));
  const completedByDate = new Map<string, Set<string>>();
  for (const log of rows.habitLogs) {
    if (!log.completed || !knownHabitIds.has(log.daily_habit_id)) continue;
    const set = completedByDate.get(log.date) ?? new Set<string>();
    set.add(log.daily_habit_id);
    completedByDate.set(log.date, set);
  }
  const spineDates = new Set(rows.spineDates);

  const habitsRail: DotState[] = [];
  const dayPcts: number[] = [];
  for (const date of dates) {
    const eligibleHabits = rows.habits.filter((habit) => habit.effective_date <= date);
    const completedSet = completedByDate.get(date);
    const completedCount = eligibleHabits.filter((habit) => completedSet?.has(habit.id)).length;
    const { dot, pct } = classifyHabitDay({
      eligible: eligibleHabits.length,
      completed: completedCount,
      hasSpineRow: spineDates.has(date),
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
    training: { rail: trainingRail, completed, planned, pct: trainingPct },
    nutrition: {
      rail: nutritionRail,
      onTarget,
      loggedDays,
      pct: nutritionPct,
      calories,
      protein,
    },
    habits: { rail: habitsRail, avgPct, daysBelow50, perHabit },
  };
}

export const getClientAdherence = async (
  clientId: string,
  days: number
): Promise<AdherenceSummary> => {
  const today = await getClientTodayString(clientId);
  const startDate = addDaysToDateString(today, -(days - 1));
  const dates = Array.from({ length: days }, (_, i) => addDaysToDateString(startDate, i));

  const [events, nutritionLogs, habits, habitLogs, spine] = await Promise.all([
    supabaseAdmin
      .from("training_events")
      .select("date, status")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", today),
    supabaseAdmin
      .from("nutrition_logs")
      .select(
        "date, nutrition_adherence, calories_consumed, protein_g, target_calories, target_protein_g"
      )
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", today),
    // `name` costs nothing here — same query, one more column — and is what
    // lets the Signals card name a habit with no logs in the window.
    supabaseAdmin
      .from("daily_habits")
      .select("id, name, effective_date")
      .eq("client_id", clientId)
      .eq("is_active", true)
      // The coach's own habit order, matching the Habits tab (`getClientHabits`).
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("daily_habit_logs")
      .select("date, daily_habit_id, completed")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", today),
    supabaseAdmin
      .from("daily_logs")
      .select("date")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", today),
  ]);

  for (const result of [events, nutritionLogs, habits, habitLogs, spine]) {
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
    spineDates: (spine.data ?? []).map((row) => row.date),
  });
};
