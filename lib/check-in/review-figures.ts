import { format } from "date-fns";
import { formatDeltaValue, type DeltaInfo } from "@/components/check-in/delta-format";
import { shouldShowRegenerationBanner } from "@/utils/nutrition-helpers";
import type { GoalPosition, GoalProgress } from "@/types/check-in";

/**
 * The review page's figure rules, spelled once. The KPI ribbon and the goal
 * strip draw them; the AI prompt describes them in the same words, so the
 * model is never handed a verdict the page would word differently. Pure:
 * every unit-bearing number arrives already formatted in the viewer's unit.
 */

export type GoalRowTone = "good" | "attention" | "neutral";
export type GoalRowState = { text: string; tone: GoalRowTone };

export type GoalRow = {
  name: string;
  percentComplete: number;
  start?: string;
  goal: string;
  state: GoalRowState;
  /** False when no reading existed as of the check-in's day: nothing to judge. */
  judged: boolean;
};

// The goal exists; no reading existed as of the check-in's day. Neutral rather
// than a warning: the coach's next move is to record one, not to worry.
const NO_READING: GoalRowState = { text: "No reading yet", tone: "neutral" };

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Where the client stands, then how far — joined by a middot.
 *
 * The verdict half reads `status` before `paceStatus` before `isOnTrack`, and
 * that order is the point. `paceStatus` judges whether the RATE REQUIRED to hit
 * the deadline is safe; `isOnTrack` judges whether the client is moving TOWARDS
 * the goal. Letting the first mask the second put "On track" on a client 5 kg
 * past a weight-loss target whose `isOnTrack` was already, correctly, false.
 *
 * Weight and body fat both resolve here, so the two rows cannot reach different
 * verdicts about one client — body fat carries no `paceStatus` and falls
 * through to the trend legs.
 */
export function resolveGoalRowState(goal: GoalPosition, distance: string): GoalRowState {
  // `remaining` is signed: its magnitude is the distance BACK to the target
  // once the goal has been passed, so `status` decides which sentence it is in.
  if (goal.status === "overshot") {
    return { text: `Reached · ${distance} past target`, tone: "good" };
  }
  if (goal.status === "achieved") return { text: "Reached", tone: "good" };

  const toGo = `${distance} to go`;
  if (goal.paceStatus === "on_track") return { text: `On track · ${toGo}`, tone: "good" };
  if (goal.paceStatus === "behind_pace") {
    return { text: `Behind pace · ${toGo}`, tone: "attention" };
  }
  if (goal.paceStatus === "unrealistic") {
    return { text: `Deadline unrealistic · ${toGo}`, tone: "attention" };
  }
  if (goal.isOnTrack) return { text: `On track · ${toGo}`, tone: "good" };
  return { text: `Needs attention · ${toGo}`, tone: "attention" };
}

/**
 * One row per goal that is set, as the strip draws them. `position` is the
 * reading as of the check-in's day against the goal, or null when there was
 * none — the goal is still a row, with no verdict. `formatWeight` renders a
 * kilogram value in the viewer's unit.
 */
export function buildGoalRows(
  goalProgress: GoalProgress,
  formatWeight: (kg: number) => string
): GoalRow[] {
  const { weight, bodyFat } = goalProgress;
  const rows: GoalRow[] = [];

  if (weight) {
    const { position } = weight;
    rows.push({
      name: "Weight",
      percentComplete: position?.percentComplete ?? 0,
      start: weight.startingWeight !== undefined ? formatWeight(weight.startingWeight) : undefined,
      goal: formatWeight(weight.goal),
      state: position
        ? resolveGoalRowState(position, formatWeight(Math.abs(position.remaining)))
        : NO_READING,
      judged: position !== null,
    });
  }

  if (bodyFat) {
    const { position } = bodyFat;
    rows.push({
      name: "Body fat",
      percentComplete: position?.percentComplete ?? 0,
      start: bodyFat.startingBodyFat !== undefined ? `${bodyFat.startingBodyFat} %` : undefined,
      goal: `${bodyFat.goal} %`,
      state: position
        ? resolveGoalRowState(position, `${round1(Math.abs(position.remaining))}%`)
        : NO_READING,
      judged: position !== null,
    });
  }

  return rows;
}

/** The rail's meta: the deadline and the days to it, or how far past it is. */
export function describeGoalDeadline(deadline: GoalProgress["deadline"]): string | undefined {
  if (!deadline) return undefined;
  return deadline.isPastDeadline
    ? `Overdue by ${Math.abs(deadline.daysRemaining)} days`
    : `deadline ${format(new Date(deadline.date), "d MMM")} · ${deadline.daysRemaining} days`;
}

type GoalFooter = {
  tone: "good" | "attention";
  text: string;
  /** True only for the goal-met note on the client's live goal: the one case that offers "Set new goals". */
  offerNewGoals: boolean;
};

/**
 * ONE footer, and goals outrank nutrition.
 *
 * The goal-met note only once there is nothing left to approach, and only
 * while the goal judged is still the client's live one: a page about a goal
 * since replaced never invites replacing it again (commit 8b). A goal with no
 * reading is neither met nor unmet, so it neither earns the note nor blocks it
 * (owner decision 2026-09-02) — and with nothing judged there is nothing to
 * call met.
 *
 * Otherwise the drift note: the reading as of the check-in's day has moved far
 * enough from the base weight of the nutrition version covering that day that
 * the plan no longer described them. Symmetric — a gain invalidates the
 * targets as surely as a loss. Targets built for a goal the client has passed
 * need the goal reset first, so a nutrition note never appears beside a met
 * goal.
 */
export function resolveGoalFooter(input: {
  rows: GoalRow[];
  goalIsCurrent: boolean;
  currentWeightKg?: number;
  nutritionPlanBaseWeightKg?: number;
  nutritionPlanEffectiveDate?: string;
  formatWeight: (kg: number) => string;
}): GoalFooter | null {
  const judged = input.rows.filter((row) => row.judged);
  const allMet =
    judged.length > 0 &&
    judged.every((row) => row.state.tone === "good" && row.state.text.startsWith("Reached"));
  if (allMet && input.goalIsCurrent) {
    return { tone: "good", text: "Goal met - consider setting a new target.", offerNewGoals: true };
  }

  const current = input.currentWeightKg;
  const baseWeight = input.nutritionPlanBaseWeightKg;
  if (
    current !== undefined &&
    baseWeight !== undefined &&
    shouldShowRegenerationBanner(current, baseWeight)
  ) {
    const since = input.nutritionPlanEffectiveDate
      ? ` on ${format(new Date(input.nutritionPlanEffectiveDate), "d MMM")}`
      : "";
    return {
      tone: "attention",
      text: `Weight has moved ${input.formatWeight(Math.abs(current - baseWeight))} since these targets took effect${since} - consider reviewing their nutrition plan.`,
      offerNewGoals: false,
    };
  }
  return null;
}

/**
 * The ribbon's comparison line for a progress metric: the delta against the
 * PREVIOUS CHECK-IN when one exists, otherwise the change from the starting
 * value on a first check-in. Null when neither is available.
 *
 * A check-in is a periodic report, so it reports against the previous report;
 * a measurement logged in between belongs to the Journey series and is
 * deliberately not consulted here (owner decision, 2026-08-31). The label says
 * "vs last check-in" rather than "vs previous week" because the gap between two
 * check-ins is whatever it is — this cell once read "vs previous week" above a
 * delta measured against a check-in 92 days old.
 */
export function metricComparison(input: {
  current?: number;
  change?: number;
  startingValue?: number;
  hasPreviousCheckIn: boolean;
  /** Down is good — weight, body fat, stress, soreness. */
  invert: boolean;
}): { label: string; delta: DeltaInfo } | null {
  const { current, change, startingValue, hasPreviousCheckIn, invert } = input;
  if (hasPreviousCheckIn && change !== undefined) {
    return { label: "vs last check-in", delta: formatDeltaValue(change, invert) };
  }
  if (!hasPreviousCheckIn && current !== undefined && startingValue !== undefined) {
    return { label: "vs start", delta: formatDeltaValue(current - startingValue, invert) };
  }
  return null;
}
