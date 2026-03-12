"use client";

import type { WeeklyBudgetValidation } from "@/utils/nutrition-helpers";
import { cn } from "@/lib/utils";

type WeeklyBudgetIndicatorProps = {
  validation: WeeklyBudgetValidation;
};

export function WeeklyBudgetIndicator({ validation }: WeeklyBudgetIndicatorProps) {
  const { isValid, totalCalories, weeklyTarget, difference, percentOfTarget } = validation;
  const clampedPercent = Math.min(percentOfTarget, 120);

  const diffLabel =
    difference === 0
      ? ""
      : difference > 0
        ? `+${difference}`
        : `${difference}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Weekly baseline budget</span>
        <span
          className={cn(
            "font-medium tabular-nums",
            isValid ? "text-emerald-600" : "text-red-500"
          )}
        >
          {totalCalories.toLocaleString()} / {weeklyTarget.toLocaleString()} cal
          {diffLabel ? ` (${diffLabel})` : ""}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            isValid ? "bg-emerald-500" : "bg-red-500"
          )}
          style={{ width: `${Math.min(clampedPercent, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{percentOfTarget}%</span>
        {isValid && <span className="text-emerald-600 font-medium">Budget balanced</span>}
        {!isValid && (
          <span className="text-red-500 font-medium">
            {difference > 0 ? "Over budget" : "Under budget"}
          </span>
        )}
      </div>
    </div>
  );
}
