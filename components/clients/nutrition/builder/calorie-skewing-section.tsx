"use client";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { WeeklyBudgetIndicator } from "./weekly-budget-indicator";
import { CalorieSkewingDayRow } from "./calorie-skewing-day-row";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { DayCalorieOverrides } from "@/types/check-in";
import type { DailyNutritionTargets, WeeklyBudgetValidation, DayOfWeek } from "@/utils/nutrition-helpers";
import { cn } from "@/lib/utils";

type CalorieSkewingSectionProps = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  dayOverrides: DayCalorieOverrides | null;
  onDayChange: (day: DayOfWeek, field: keyof DayCalorieOverrides[DayOfWeek], value: number) => void;
  weeklyTargets: DailyNutritionTargets[] | null;
  budgetValidation: WeeklyBudgetValidation | null;
  macroMode: "proportional" | "custom";
  onMacroModeChange: (mode: "proportional" | "custom") => void;
  onReset: () => void;
  onSave: () => void;
  isSaving: boolean;
  hasPlan: boolean;
};

export function CalorieSkewingSection({
  enabled,
  onToggle,
  dayOverrides,
  onDayChange,
  weeklyTargets,
  budgetValidation,
  macroMode,
  onMacroModeChange,
  onReset,
  onSave,
  isSaving,
  hasPlan,
}: CalorieSkewingSectionProps) {
  if (!hasPlan) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[12.5px] font-semibold text-[#0c1a1e]">
          Custom day distribution
        </label>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="h-[22px] w-[40px] rounded-[11px] data-[state=checked]:bg-[#0d9488] data-[state=unchecked]:bg-[rgba(13,148,136,0.12)] [&>[data-slot=switch-thumb]]:h-4 [&>[data-slot=switch-thumb]]:w-4 [&>[data-slot=switch-thumb]]:shadow-[0_1px_3px_rgba(0,0,0,0.12)] [&>[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[18px]"
        />
      </div>

      {enabled && dayOverrides && weeklyTargets && budgetValidation && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <WeeklyBudgetIndicator validation={budgetValidation} />

          {/* Mode selector */}
          <div className="flex gap-1 p-0.5 bg-muted rounded-md">
            <button
              type="button"
              onClick={() => onMacroModeChange("proportional")}
              className={cn(
                "flex-1 text-xs py-1 rounded-sm transition-colors",
                macroMode === "proportional"
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Proportional
            </button>
            <button
              type="button"
              onClick={() => onMacroModeChange("custom")}
              className={cn(
                "flex-1 text-xs py-1 rounded-sm transition-colors",
                macroMode === "custom"
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Custom macros
            </button>
          </div>

          {/* Day rows */}
          <div>
            {DAYS_OF_WEEK.map((day) => {
              const target = weeklyTargets.find((t) => t.day === day);
              const override = dayOverrides[day];
              if (!target || !override) return null;

              const totalBaseline = budgetValidation.totalCalories;
              const pct = totalBaseline > 0 ? (override.calories / totalBaseline) * 100 : 0;

              return (
                <CalorieSkewingDayRow
                  key={day}
                  day={day}
                  isTrainingDay={target.isTrainingDay}
                  override={override}
                  trainingCalories={target.trainingSessionCalories + target.externalActivityCalories}
                  percentOfBudget={pct}
                  macroMode={macroMode}
                  onCaloriesChange={(v) => onDayChange(day, "calories", v)}
                  onMacroChange={(field, v) => onDayChange(day, field, v)}
                />
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="text-xs h-7"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset to default
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={isSaving || !budgetValidation.isValid}
              className="text-xs h-7 ml-auto"
            >
              {isSaving ? "Saving..." : "Save distribution"}
            </Button>
          </div>

          {!budgetValidation.isValid && (
            <p className="text-xs text-red-500">
              Adjust day calories to match the weekly baseline budget before saving.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
