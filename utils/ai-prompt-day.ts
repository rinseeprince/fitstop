import { format } from "date-fns";
import { sanitizeForAIPrompt } from "./ai-prompt-sanitizer";
import { loggedDisplayQuality } from "@/lib/training-display-state";
import { AI_PROMPT_TEXT_LIMIT } from "@/lib/constants";
import type { CheckInTrainingEventDetail } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { NutritionDay } from "@/types/schedule";

/**
 * One day of the check-in week as the AI reads it: what was prescribed and
 * what was logged against it, source by source, with "nothing logged" written
 * wherever nothing was (owner decision 2026-09-18). Every figure is the review
 * page's own — the workout's quality off its log, the exercise lines from
 * commit 11b-2, the food row the check-in froze, the day-form row, the habit
 * rail — so nothing here is worked out a second way.
 */
export type ReviewDay = {
  date: string;
  /**
   * Whether the client logged anything at all this day, by the one definition
   * (`loggedDays`, lib/logged-days.ts). Null when it cannot be read for this
   * week — a legacy row — and the line is then left out.
   */
  logged: boolean | null;
  /** The day's workouts in their order, each with the quality on its log. */
  workouts: CheckInTrainingEventDetail[];
  /** One line per logged exercise, keyed by session log id. */
  exerciseLines: Map<string, string[]>;
  /** The day's food row: what was eaten beside the target. Null when the week has no row for it. */
  nutrition: NutritionDay | null;
  /** The day-form row: the day's wellness scores. */
  dailyLog: DailyLog | null;
  /** The habits the client had that day, ticked or not. */
  habits: { name: string; ticked: boolean }[];
};

const text = (value: string) => sanitizeForAIPrompt(value, AI_PROMPT_TEXT_LIMIT);
const kcal = (value: number) => `${value.toLocaleString("en-GB")} kcal`;

/** "Thursday 17 September", from the client's own calendar date. Local noon keeps the weekday stable across DST. */
const describeDate = (date: string): string =>
  format(new Date(`${date}T12:00:00`), "EEEE d MMMM");

function macros(protein: number | null, carbs: number | null, fat: number | null): string {
  const parts = [
    protein != null ? `protein ${protein} g` : null,
    carbs != null ? `carbs ${carbs} g` : null,
    fat != null ? `fat ${fat} g` : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** The kernel's standing for the day, in words: hit, or which side it landed on. */
function verdict(day: NutritionDay): string {
  if (day.status === "hit") return "hit target";
  if (day.status === "partial" || day.status === "missed") {
    const side = (day.actualCalories ?? 0) > (day.targetCalories ?? 0) ? "over" : "under";
    return `${day.status}, ${side} target`;
  }
  return "not judged";
}

function foodLine(day: NutritionDay | null): string {
  if (!day) return "Food: nothing logged";
  const eaten =
    day.actualCalories != null
      ? `${kcal(day.actualCalories)} eaten${macros(day.actualProteinG, day.actualCarbsG, day.actualFatG)}`
      : "nothing logged";
  const target =
    day.targetCalories != null
      ? `target ${kcal(day.targetCalories)}${macros(day.targetProteinG, day.targetCarbsG, day.targetFatG)}`
      : "no target set";
  const judged = day.actualCalories != null && day.targetCalories != null ? `: ${verdict(day)}` : "";
  return `Food: ${eaten}, ${target}${judged}`;
}

function wellnessLine(log: DailyLog | null): string {
  const scores = [
    log?.mood != null ? `mood ${log.mood}/5` : null,
    log?.energy != null ? `energy ${log.energy}/10` : null,
    log?.sleep != null ? `sleep ${log.sleep}/10` : null,
    log?.stress != null ? `stress ${log.stress}/10` : null,
    log?.soreness != null ? `soreness ${log.soreness}/10` : null,
  ].filter((score): score is string => score != null);
  return scores.length > 0 ? `Wellness: ${scores.join(", ")}` : "Wellness: nothing logged";
}

function trainingLines(day: ReviewDay): string[] {
  if (day.workouts.length === 0) return ["Training: rest day, nothing scheduled"];
  const lines: string[] = [];
  for (const workout of day.workouts) {
    const name = text(workout.sessionName);
    // How the workout went is read off its LOG, never off the status word —
    // the same classifier the review's pills and its count come from.
    const quality = loggedDisplayQuality(workout);
    if (quality === null) {
      lines.push(`Training: ${name}: missed, not logged`);
      continue;
    }
    const performed = workout.performedSessionName ? text(workout.performedSessionName) : null;
    const head = performed && performed !== name ? `${performed} in place of ${name}` : name;
    // A workout logged through the check-in's checklist records an outcome
    // and no sets, so it has no exercise lines; say so rather than leave the
    // model to guess what an empty block means.
    const exercises = workout.sessionLogId ? day.exerciseLines.get(workout.sessionLogId) ?? [] : [];
    lines.push(`Training: ${head}: logged, ${quality}${exercises.length === 0 ? " (no sets recorded)" : ""}`);
    if (workout.notes) lines.push(`  Note: "${text(workout.notes)}"`);
    for (const line of exercises) lines.push(`  ${line}`);
  }
  return lines;
}

export function describeDay(day: ReviewDay): string {
  const lines: string[] = [describeDate(day.date)];
  if (day.logged === false) lines.push("Nothing logged.");
  lines.push(...trainingLines(day));
  lines.push(foodLine(day.nutrition));
  lines.push(wellnessLine(day.dailyLog));
  if (day.habits.length > 0) {
    lines.push(
      `Habits: ${day.habits.map((habit) => `${text(habit.name)}, ${habit.ticked ? "ticked" : "not ticked"}`).join("; ")}`
    );
  }
  return lines.join("\n");
}
