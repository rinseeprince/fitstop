"use client";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { DayCalorieOverride } from "@/types/check-in";
import type { DayOfWeek } from "@/utils/nutrition-helpers";
import { cn } from "@/lib/utils";

type CalorieSkewingDayRowProps = {
  day: DayOfWeek;
  isTrainingDay: boolean;
  override: DayCalorieOverride;
  trainingCalories: number;
  percentOfBudget: number;
  macroMode: "proportional" | "custom";
  onCaloriesChange: (value: number) => void;
  onMacroChange: (field: "protein_g" | "carbs_g" | "fat_g", value: number) => void;
};

export function CalorieSkewingDayRow({
  day,
  isTrainingDay,
  override,
  trainingCalories,
  percentOfBudget,
  macroMode,
  onCaloriesChange,
  onMacroChange,
}: CalorieSkewingDayRowProps) {
  const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
  const totalCalories = override.calories + trainingCalories;

  return (
    <div className="space-y-2 py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium w-24 shrink-0">{dayLabel}</span>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 h-4 shrink-0",
            isTrainingDay
              ? "border-blue-300 text-blue-600 bg-blue-50"
              : "border-zinc-300 text-zinc-500 bg-zinc-50"
          )}
        >
          {isTrainingDay ? "Training" : "Rest"}
        </Badge>
        <div className="flex items-center gap-1.5 ml-auto">
          <Input
            type="number"
            value={override.calories || ""}
            onChange={(e) => onCaloriesChange(Math.round(Number(e.target.value)))}
            className="w-20 h-7 text-sm text-right tabular-nums"
            min={0}
          />
          <span className="text-xs text-muted-foreground w-7">cal</span>
        </div>
      </div>

      {/* Total with training burn */}
      {trainingCalories > 0 && (
        <div className="flex items-center justify-end text-xs text-muted-foreground gap-1">
          <span>Total: {totalCalories} cal</span>
          <span className="text-blue-500">(+{trainingCalories} burn)</span>
        </div>
      )}

      {/* Percentage bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/60 transition-all duration-200"
            style={{ width: `${Math.min(percentOfBudget, 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
          {percentOfBudget.toFixed(1)}%
        </span>
      </div>

      {/* Custom macro inputs */}
      {macroMode === "custom" && (
        <div className="flex items-center gap-2 pl-6">
          <MacroInput label="P" value={override.protein_g} onChange={(v) => onMacroChange("protein_g", v)} />
          <MacroInput label="C" value={override.carbs_g} onChange={(v) => onMacroChange("carbs_g", v)} />
          <MacroInput label="F" value={override.fat_g} onChange={(v) => onMacroChange("fat_g", v)} />
        </div>
      )}
    </div>
  );
}

function MacroInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      <Input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(Math.round(Number(e.target.value)))}
        className="w-14 h-6 text-xs text-right tabular-nums"
        min={0}
      />
      <span className="text-[10px] text-muted-foreground">g</span>
    </div>
  );
}
