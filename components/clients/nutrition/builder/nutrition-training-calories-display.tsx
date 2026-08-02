"use client";

import { Flame } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";

type NutritionTrainingCaloriesDisplayProps = {
  /** Only ever tested for truthiness here, so the tab asks the nutrition
   *  endpoint for a boolean instead of fetching the whole training plan. */
  hasTrainingPlan: boolean;
  isLoading: boolean;
  dailyCalories: number;
  weeklyCalories: number;
  caloriesByDay: Record<string, number> | null;
  includeActivityBurn: boolean;
  onToggleActivityBurn: (value: boolean) => void;
  isSavingToggle?: boolean;
  /** How a training-day surplus distributes across macros (mig 117). */
  surplusAsCarbs: boolean;
  onToggleSurplusAsCarbs: (value: boolean) => void;
  isSavingSurplus?: boolean;
  dailyTargets?: DailyNutritionTargets[];
};

export function NutritionTrainingCaloriesDisplay({
  hasTrainingPlan,
  isLoading,
  dailyCalories,
  weeklyCalories,
  caloriesByDay,
  includeActivityBurn,
  onToggleActivityBurn,
  isSavingToggle,
  surplusAsCarbs,
  onToggleSurplusAsCarbs,
  isSavingSurplus,
  dailyTargets,
}: NutritionTrainingCaloriesDisplayProps) {
  if (isLoading) {
    return (
      <div className="bg-muted/50 rounded-lg p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-3/4 mb-2" />
        <div className="h-3 bg-muted rounded w-1/2" />
      </div>
    );
  }

  // No plan → no section. Training calories attach to actual training_events
  // server-side, so there's nothing actionable to show here without a plan.
  if (!hasTrainingPlan) {
    return null;
  }

  // Check if any daily target uses the percentage model
  const hasPercentageModel = dailyTargets?.some((d) => d.calorieSurplusPercentage != null);
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  return (
    <div className="space-y-3">
      <div className={`bg-secondary/10 rounded-lg p-5 border border-secondary/20 transition-opacity ${!includeActivityBurn ? "opacity-50" : ""}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-training/10 flex items-center justify-center flex-shrink-0">
            <Flame className="h-4 w-4 text-training" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">
                {hasPercentageModel ? "Training Day Surplus" : "Training Calories"}
              </h4>
              {!includeActivityBurn ? (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-medium bg-muted text-muted-foreground">
                  Not added to targets
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-medium bg-training/10 text-training">
                  Auto
                </span>
              )}
            </div>
            {hasPercentageModel ? (
              // Percentage surplus display
              <div className="mt-2 pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {days.map((day) => {
                    const target = dailyTargets?.find((d) => d.day === day);
                    const surplus = target?.calorieSurplusPercentage;
                    const shortDay = day.slice(0, 2).toUpperCase();
                    return (
                      <div
                        key={day}
                        className={`text-[10px] px-2.5 py-1 rounded-lg font-medium ${
                          surplus != null ? "bg-training/10 text-training" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {shortDay}: {surplus != null ? `+${surplus}%` : "Rest"}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // Legacy flat calorie display
              <>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="bg-card rounded-lg p-3">
                    <p className="text-xl font-semibold text-training">+{dailyCalories}</p>
                    <p className="text-xs text-muted-foreground">cal/day avg</p>
                  </div>
                  <div className="bg-card rounded-lg p-3">
                    <p className="text-xl font-semibold text-training">{weeklyCalories}</p>
                    <p className="text-xs text-muted-foreground">cal/week</p>
                  </div>
                </div>
                {caloriesByDay && (
                  <div className="mt-4 pt-4">
                    <div className="flex flex-wrap gap-1.5">
                      {days.map((day) => {
                        const cals = caloriesByDay[day] || 0;
                        const shortDay = day.slice(0, 2).toUpperCase();
                        return (
                          <div
                            key={day}
                            className={`text-[10px] px-2.5 py-1 rounded-lg font-medium ${
                              cals > 0 ? "bg-training/10 text-training" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {shortDay}: {cals > 0 ? `+${cals}` : "-"}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="space-y-0.5">
          <Label className="text-[12.5px] font-semibold text-[#0c1a1e]">
            {hasPercentageModel ? "Apply training day surplus" : "Add activity burn to calorie targets"}
          </Label>
          <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
            {hasPercentageModel
              ? "When on, training days get a percentage boost above baseline calories"
              : "When on, estimated calories burned from training are added to daily targets"}
          </p>
        </div>
        <Switch
          checked={includeActivityBurn}
          onCheckedChange={onToggleActivityBurn}
          disabled={isSavingToggle}
          className="h-[22px] w-[40px] rounded-[11px] data-[state=checked]:bg-[#0d9488] data-[state=unchecked]:bg-[rgba(13,148,136,0.12)] [&>[data-slot=switch-thumb]]:h-4 [&>[data-slot=switch-thumb]]:w-4 [&>[data-slot=switch-thumb]]:shadow-[0_1px_3px_rgba(0,0,0,0.12)] [&>[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[18px]"
        />
      </div>

      {/* Surplus distribution — only relevant when burn adds calories */}
      {includeActivityBurn && (
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="space-y-0.5">
            <Label className="text-[12.5px] font-semibold text-[#0c1a1e]">
              Add training calories as
            </Label>
            <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
              Keep split honors your carb:fat ratio; carbs only fuels with carbs
            </p>
          </div>
          <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex flex-shrink-0">
            {([
              ["split", "Keep split"],
              ["carbs", "Carbs only"],
            ] as const).map(([key, label]) => {
              const active = (key === "carbs") === surplusAsCarbs;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isSavingSurplus}
                  onClick={() => onToggleSurplusAsCarbs(key === "carbs")}
                  className={cn(
                    "px-2.5 py-1 text-[11.5px] font-medium rounded-[4px] transition-all",
                    active
                      ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                      : "text-[#5a7d82] hover:text-[#0c1a1e]"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
