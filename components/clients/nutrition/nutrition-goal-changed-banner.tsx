"use client";

import { Target } from "lucide-react";
import { formatWeight } from "@/utils/nutrition-helpers";
import type { UnitPreference } from "@/types/check-in";
import type { GoalDrift } from "@/lib/goals/detect-goal-drift";

// "Goal changed — regenerate" banner (Session 7.8). Distinct from the weight-delta
// regeneration banner: this fires when the goal that drives the client now (active
// client_goals) differs from the goal this active plan was built against.
// Regenerating the plan re-reads the effective goal.

type NutritionGoalChangedBannerProps = {
  drift: GoalDrift | null | undefined;
  unitPreference?: UnitPreference;
};

function describe(weightKg: number | null, deadline: string | null, unitPreference: UnitPreference): string {
  if (weightKg == null) return deadline ? `Maintenance by ${deadline}` : "Maintenance";
  const weight = formatWeight(weightKg, unitPreference);
  return deadline ? `${weight} by ${deadline}` : weight;
}

export function NutritionGoalChangedBanner({
  drift,
  unitPreference = "imperial",
}: NutritionGoalChangedBannerProps) {
  if (!drift?.changed) return null;

  return (
    <div className="bg-[rgba(245,158,11,0.07)] rounded-[6px] p-3.5 flex items-start gap-2.5">
      <Target className="w-3.5 h-3.5 text-[#d97706] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
      <div className="space-y-0.5">
        <p className="text-[11.5px] font-medium text-[#d97706] leading-[1.4]">
          Goal changed since this plan was created — regenerate to apply it.
        </p>
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          {describe(drift.planGoalWeightKg, drift.planDeadline, unitPreference)} →{" "}
          {describe(drift.currentGoalWeightKg, drift.currentDeadline, unitPreference)}
        </p>
      </div>
    </div>
  );
}
