"use client";

import { Target, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  FOCUS_RING,
  MONO,
  MONO_META_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import {
  buildGoalRows,
  describeGoalDeadline,
  resolveGoalFooter,
} from "@/lib/check-in/review-figures";
import { goalTypeBesideName } from "@/lib/goals/goal-types";
import type { CheckInComparison, GoalProgress } from "@/types/check-in";

type CheckInGoalStripProps = {
  goalProgress: GoalProgress;
  clientName: string;
  clientData: CheckInComparison["client"];
  /**
   * Opens the goals sheet, from the goal-met note and from the no-goal state.
   * Absent when the page cannot route there, and both then render their words
   * alone rather than a button that goes nowhere.
   */
  onSetNewGoals?: () => void;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

export const CheckInGoalStrip = ({
  goalProgress,
  clientName,
  clientData,
  onSetNewGoals,
}: CheckInGoalStripProps) => {
  const { preference } = useUnits();
  const { goal, deadline, goalIsCurrent } = goalProgress;

  // Body weights: formatWeight converts freely and never snaps.
  const kg = (value: number): string => {
    const { value: v, unit } = formatWeight(value, preference);
    return `${round1(v)} ${unit}`;
  };

  // The rows, the deadline and the footer are worded once, in
  // lib/check-in/review-figures.ts, which the AI review's prompt reads too —
  // so the strip and the model never describe one goal two ways.
  const rows = buildGoalRows(goalProgress, kg);
  const deadlineMeta = describeGoalDeadline(deadline, goal?.type ?? null);

  // No goal was in force on the check-in's day. A goal the record cannot judge
  // yet is a row below, and a goal with no target shows itself below — never
  // this state.
  if (!goal) {
    return (
      <div>
        <SectionLabel label="Goal progress" />
        <div className="rounded-[6px] bg-white p-8 text-center">
          <Target className="mx-auto mb-4 h-12 w-12 text-[#93b0b4]" strokeWidth={1.5} />
          <p className="text-[13px] text-[#93b0b4]">No goals have been set for {clientName} yet.</p>
          {onSetNewGoals && (
            <button
              type="button"
              onClick={onSetNewGoals}
              className={cn(
                FOCUS_RING,
                "mt-1 rounded-[4px] text-[13px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
              )}
            >
              Set goals
            </button>
          )}
        </div>
      </div>
    );
  }

  const typeBesideName = goalTypeBesideName(goal.type, goal.name);
  const footer = resolveGoalFooter({
    rows,
    goalIsCurrent,
    currentWeightKg: clientData.currentWeight,
    nutritionPlanBaseWeightKg: clientData.nutritionPlanBaseWeightKg,
    nutritionPlanEffectiveDate: clientData.nutritionPlanEffectiveDate,
    formatWeight: kg,
  });
  const offerNewGoals = footer?.offerNewGoals ?? false;

  return (
    <div>
      <SectionLabel label="Goal progress" meta={deadlineMeta} />


      <div className="rounded-[6px] bg-white px-5">
        {/* Rows come from the goal's targets, so a goal that sets none shows
            itself in their place: its name, its type where the name doesn't
            say it, and its deadline on the rail. */}
        {rows.length === 0 && (
          <div className="py-4">
            <p className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] font-semibold text-[#0c1a1e]">{goal.name}</span>
              {typeBesideName && (
                <span className="shrink-0 text-[12px] text-[#93b0b4]">{typeBesideName}</span>
              )}
            </p>
            <p className="mt-1 text-[13px] text-[#93b0b4]">No target to track progress against</p>
          </div>
        )}
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
                row.state.tone === "good"
                  ? "text-[#0d9488]"
                  : row.state.tone === "attention"
                    ? "text-[#d97706]"
                    : "text-[#93b0b4]"
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
            {offerNewGoals && onSetNewGoals && (
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
