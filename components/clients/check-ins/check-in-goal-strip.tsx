"use client";

import { Target, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  MONO,
  MONO_META_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import { shouldShowRegenerationBanner } from "@/utils/nutrition-helpers";
import type { CheckInComparison, GoalProgress } from "@/types/check-in";

type CheckInGoalStripProps = {
  goalProgress: GoalProgress;
  clientName: string;
  clientData: CheckInComparison["client"];
  /**
   * Opens the goal editor. Absent when the page cannot route there, and the
   * footer then renders its note alone rather than a button that goes nowhere.
   */
  onSetNewGoals?: () => void;
};

type RowState = { text: string; tone: "good" | "attention" };

type GoalRow = {
  name: string;
  percentComplete: number;
  start?: string;
  goal: string;
  state: RowState;
};

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
function resolveState(
  goal: { status?: string; isOnTrack: boolean; paceStatus?: string; remaining: number },
  distance: string
): RowState {
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

const round1 = (n: number): number => Math.round(n * 10) / 10;

export const CheckInGoalStrip = ({
  goalProgress,
  clientName,
  clientData,
  onSetNewGoals,
}: CheckInGoalStripProps) => {
  const { preference } = useUnits();
  const { weight, bodyFat, deadline } = goalProgress;

  // Body weights: formatWeight converts freely and never snaps.
  const kg = (value: number): string => {
    const { value: v, unit } = formatWeight(value, preference);
    return `${round1(v)} ${unit}`;
  };

  const rows: GoalRow[] = [];

  if (weight) {
    rows.push({
      name: "Weight",
      percentComplete: weight.percentComplete,
      start: weight.startingWeight !== undefined ? kg(weight.startingWeight) : undefined,
      goal: kg(weight.goal),
      state: resolveState(weight, kg(Math.abs(weight.remaining))),
    });
  }

  if (bodyFat) {
    rows.push({
      name: "Body fat",
      percentComplete: bodyFat.percentComplete,
      start: bodyFat.startingBodyFat !== undefined ? `${bodyFat.startingBodyFat} %` : undefined,
      goal: `${bodyFat.goal} %`,
      state: resolveState(bodyFat, `${round1(Math.abs(bodyFat.remaining))}%`),
    });
  }

  const deadlineMeta = deadline
    ? deadline.isPastDeadline
      ? `Overdue by ${Math.abs(deadline.daysRemaining)} days`
      : `deadline ${format(new Date(deadline.date), "d MMM")} · ${deadline.daysRemaining} days`
    : undefined;

  if (rows.length === 0) {
    return (
      <div>
        <SectionLabel label="Goal progress" />
        <div className="rounded-[6px] bg-white p-8 text-center">
          <Target className="mx-auto mb-4 h-12 w-12 text-[#93b0b4]" strokeWidth={1.5} />
          <p className="text-[13px] text-[#93b0b4]">No goals have been set for {clientName} yet.</p>
          <p className="mt-1 text-[13px] text-[#93b0b4]">
            Set goals in the client profile to track progress here.
          </p>
        </div>
      </div>
    );
  }

  // Only once there is nothing left to approach. A note telling a coach to set
  // new targets while one goal is still being worked towards is advice about a
  // job that is not finished.
  const allMet = rows.every((row) => row.state.tone === "good" && row.state.text.startsWith("Reached"));

  // The client's weight has moved far enough from the one their targets were
  // built on that the plan no longer describes them. Symmetric: a gain
  // invalidates the targets as surely as a loss.
  const baseWeight = clientData.nutritionPlanBaseWeightKg;
  const hasDrifted =
    clientData.currentWeight !== undefined &&
    baseWeight !== undefined &&
    shouldShowRegenerationBanner(clientData.currentWeight, baseWeight);

  // ONE footer, and goals outrank nutrition: targets built for a goal the
  // client has passed need the goal reset first, and the plan rebuilt from it.
  // Advising a nutrition review before that is advice in the wrong order.
  const footer: { tone: "good" | "attention"; text: string } | null = allMet
    ? { tone: "good", text: "Goal met - consider setting a new target." }
    : hasDrifted && clientData.currentWeight !== undefined && baseWeight !== undefined
      ? {
          tone: "attention",
          text: `Weight has moved ${kg(Math.abs(clientData.currentWeight - baseWeight))} since these targets took effect${
            clientData.nutritionPlanEffectiveDate
              ? ` on ${format(new Date(clientData.nutritionPlanEffectiveDate), "d MMM")}`
              : ""
          } - consider reviewing their nutrition plan.`,
        }
      : null;

  return (
    <div>
      <SectionLabel label="Goal progress" meta={deadlineMeta} />


      <div className="rounded-[6px] bg-white px-5">
        {rows.map((row, i) => (
          <div
            key={row.name}
            className={cn(
              "flex items-center gap-5 py-4",
              i > 0 && "border-t border-[rgba(13,148,136,0.06)]"
            )}
          >
            <span className="w-20 shrink-0 text-[13px] font-semibold text-[#0c1a1e]">
              {row.name}
            </span>

            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(13,148,136,0.06)]">
              <span
                className="block h-full rounded-full bg-[#0d9488]"
                style={{ width: `${row.percentComplete}%` }}
              />
            </span>

            <span className={cn("shrink-0 text-[11px]", MONO_META_CLASS)}>
              {row.start ?? "—"} <span className="px-0.5">&rarr;</span> {row.goal}
            </span>

            <span
              className={cn(
                "w-[190px] shrink-0 text-right text-[12px] font-medium",
                row.state.tone === "good" ? "text-[#0d9488]" : "text-[#d97706]"
              )}
            >
              {/* The distance is a numeral inside a phrase, so the two halves
                  take different fonts rather than the row taking one. */}
              {row.state.text.split(" · ").map((half, j) => (
                <span key={j} className={j > 0 ? MONO : undefined}>
                  {j > 0 && " · "}
                  {half}
                </span>
              ))}
            </span>
          </div>
        ))}

        {footer && (
          <div className="flex items-center gap-3 border-t border-[rgba(13,148,136,0.06)] py-3.5">
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-[6px]",
                footer.tone === "good"
                  ? "bg-[rgba(13,148,136,0.08)]"
                  : "bg-[rgba(245,158,11,0.07)]"
              )}
            >
              {footer.tone === "good" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#0d9488]" strokeWidth={1.5} />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-[#d97706]" strokeWidth={1.5} />
              )}
            </span>
            <span className="text-[12px] text-[#5a7d82]">{footer.text}</span>
            {/* Tied to the goal case: "Set new goals" is the wrong action to
                offer beside a nutrition-drift note. */}
            {allMet && onSetNewGoals && (
              <Button
                size="sm"
                variant="outline"
                onClick={onSetNewGoals}
                className="ml-auto h-8 border-[rgba(13,148,136,0.08)] bg-white text-xs text-[#5a7d82] hover:border-[#0d9488] hover:text-[#0d9488]"
              >
                Set new goals
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
