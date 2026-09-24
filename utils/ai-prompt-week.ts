import type { CheckInReviewInput } from "@/types/check-in-review-input";
import type { NutritionPeriodSummary } from "@/utils/nutrition-period-summary";
import { sanitizeForAIPrompt } from "./ai-prompt-sanitizer";
import { formatWeight } from "./unit-conversions";
import { summariseTraining } from "@/lib/training-adherence";
import {
  buildGoalRows,
  describeGoalDeadline,
  metricComparison,
  resolveGoalFooter,
} from "@/lib/check-in/review-figures";
import { formatDeltaValue } from "@/components/check-in/delta-format";
import { AI_PROMPT_TEXT_LIMIT } from "@/lib/constants";
import { goalTypeBesideName } from "@/lib/goals/goal-types";

/**
 * The two headline blocks of the check-in review prompt: the client's weight
 * and goal as the KPI ribbon and the goal strip show them, and the week's
 * figures as the ribbon and the cards show them — the session count through
 * the one summariser, the Nutrition card's sentence figure for figure, the
 * wellness changes and the habit counts. Every rule is the page's own
 * (lib/check-in/review-figures.ts); nothing here is worked out a second way.
 */

const text = (value: string) => sanitizeForAIPrompt(value, AI_PROMPT_TEXT_LIMIT);
const kcal = (value: number) => `${value.toLocaleString("en-GB")} kcal`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const WELLNESS_METRICS = [
  { key: "mood", label: "mood", inverse: false },
  { key: "energy", label: "energy", inverse: false },
  { key: "sleep", label: "sleep", inverse: false },
  { key: "stress", label: "stress", inverse: true },
  { key: "soreness", label: "soreness", inverse: true },
] as const;

export function weightAndGoal(input: CheckInReviewInput): string[] {
  const { checkIn, comparison, viewer } = input;
  // Body weights: formatWeight converts freely and never snaps, rounded to one
  // decimal like the ribbon and the strip.
  const weight = (kg: number) => {
    const { value, unit } = formatWeight(kg, viewer);
    return `${Math.round(value * 10) / 10} ${unit}`;
  };
  const hasPreviousCheckIn = comparison?.comparison.previous != null;
  const changes = comparison?.comparison.changes;
  const withChange = (value: string, comparisonLine: ReturnType<typeof metricComparison>) =>
    comparisonLine ? `${value}, ${comparisonLine.delta.text} ${comparisonLine.label}` : value;

  const lines = ["WEIGHT AND GOAL"];
  lines.push(
    checkIn.weight != null
      ? `Weight: ${withChange(
          weight(checkIn.weight),
          metricComparison({
            current: checkIn.weight,
            change: changes?.weight,
            startingValue: comparison?.goalProgress.weight?.startingWeight,
            hasPreviousCheckIn,
            invert: true,
          })
        )}`
      : "Weight: not recorded this check-in"
  );
  lines.push(
    checkIn.bodyFatPercentage != null
      ? `Body fat: ${withChange(
          `${checkIn.bodyFatPercentage}%`,
          metricComparison({
            current: checkIn.bodyFatPercentage,
            change: changes?.bodyFatPercentage,
            startingValue: comparison?.goalProgress.bodyFat?.startingBodyFat,
            hasPreviousCheckIn,
            invert: true,
          })
        )}`
      : "Body fat: not tracked"
  );

  if (!comparison) {
    lines.push("Goal: not available");
    return lines;
  }
  const { goal } = comparison.goalProgress;
  if (!goal) {
    lines.push("Goal: none set as of this check-in");
    return lines;
  }
  const rows = buildGoalRows(comparison.goalProgress, weight);
  if (rows.length === 0) {
    // A goal with no target, as the strip shows it: the goal itself, its type
    // where its name doesn't say it, and its deadline below.
    const type = goalTypeBesideName(goal.type, goal.name);
    lines.push(`Goal: ${text(goal.name)}${type ? ` (${type})` : ""}, with no target to track progress against`);
  }
  for (const row of rows) {
    const start = row.start ? ` from a start of ${row.start}` : "";
    lines.push(`Goal, ${row.name.toLowerCase()}: ${row.goal}${start}. ${row.state.text}`);
  }
  const deadline = describeGoalDeadline(comparison.goalProgress.deadline, goal.type);
  if (deadline) lines.push(deadline.charAt(0).toUpperCase() + deadline.slice(1));
  const footer = resolveGoalFooter({
    rows,
    goalIsCurrent: comparison.goalProgress.goalIsCurrent,
    currentWeightKg: comparison.comparison.client.currentWeight,
    nutritionPlanBaseWeightKg: comparison.comparison.client.nutritionPlanBaseWeightKg,
    nutritionPlanEffectiveDate: comparison.comparison.client.nutritionPlanEffectiveDate,
    formatWeight: weight,
  });
  if (footer) lines.push(footer.text);
  return lines;
}

/** The Nutrition card's sentence, figure for figure. */
function foodFigures(s: NutritionPeriodSummary): string {
  if (s.loggedDays === 0) {
    const targets =
      s.targetedDays > 0
        ? `; a target was set on ${s.targetedDays} of the ${plural(s.periodDays, "day")}`
        : "; no target was set on any day";
    return `Food: nothing logged on any day${targets}`;
  }
  if (s.targetTotals && s.consumedOnTargetedDays) {
    const verdict = s.periodVerdict?.toUpperCase() ?? "not judged";
    let line = `Food: ${kcal(s.consumedOnTargetedDays.calories)} of ${kcal(s.targetTotals.calories)} over the ${plural(s.targetedDays, "day")} with a target: ${verdict}, ${s.onTarget}/${s.targetedDays} days on target.`;
    if (s.perJudgedDay) {
      const { consumed, target } = s.perJudgedDay;
      line += ` Average per logged day against its target: ${kcal(consumed.calories)} (target ${kcal(target.calories)}), protein ${consumed.proteinG} g (target ${target.proteinG} g), carbs ${consumed.carbsG} g (target ${target.carbsG} g), fat ${consumed.fatG} g (target ${target.fatG} g).`;
    } else {
      line += " Nothing logged on a day with a target.";
    }
    if (s.loggedNoTargetDays > 0) {
      line += ` ${plural(s.loggedNoTargetDays, "logged day")} had no target and ${s.loggedNoTargetDays === 1 ? "is" : "are"} not counted.`;
    }
    return line;
  }
  const average = s.intakePerLoggedDay ? ` what was eaten averaged ${kcal(s.intakePerLoggedDay.calories)} a day` : " nothing to average";
  return `Food: no target was set on any day this week;${average}.`;
}

export function weekFigures(input: CheckInReviewInput): string[] {
  const lines = ["THE WEEK IN FIGURES"];

  // Through `summariseTraining`, exactly like the KPI ribbon: a partial
  // workout counts as done, and the breakdown is printed beside the number.
  const training = summariseTraining(input.workouts);
  if (training.planned === 0) {
    lines.push("Training: no sessions were prescribed this week");
  } else {
    const detail = [
      training.partial > 0 ? `${training.partial} partial` : null,
      training.missed > 0 ? `${training.missed} missed` : null,
    ].filter((part): part is string => part != null);
    lines.push(
      `Training: ${training.completed} of ${plural(training.planned, "session")} done${detail.length ? ` (${detail.join(", ")})` : ""}`
    );
  }

  lines.push(foodFigures(input.nutrition.summary));

  if (input.comparison) {
    const { previous, changes } = input.comparison.comparison;
    if (previous) {
      const deltas = WELLNESS_METRICS.map(({ key, label, inverse }) => {
        const change = changes[key];
        return `${label} ${change !== undefined ? formatDeltaValue(change, inverse).text : "not compared"}`;
      });
      lines.push(`Wellness, change since the last check-in: ${deltas.join(", ")}`);
    } else {
      lines.push("Wellness: no previous check-in to compare with");
    }
  }

  const habits = input.habits.filter((habit) => habit.eligibleDays > 0);
  if (habits.length > 0) {
    lines.push(
      `Habits: ${habits.map((habit) => `${text(habit.name)} ${habit.completedDays}/${habit.eligibleDays} days`).join("; ")}`
    );
  }
  return lines;
}
