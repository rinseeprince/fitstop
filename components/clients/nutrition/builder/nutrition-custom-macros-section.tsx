"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO_META_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { MacroGrams } from "@/utils/custom-macro-conversion";

type NutritionCustomMacrosSectionProps = {
  calories: number;
  onCaloriesChange: (value: number) => void;
  proteinPct: number;
  onProteinPctChange: (value: number) => void;
  carbPct: number;
  onCarbPctChange: (value: number) => void;
  fatPct: number;
  onFatPctChange: (value: number) => void;
  /** Live derived grams (cal x %/4 | /9). */
  grams: MacroGrams;
  /** Re-totaled actual calories from the rounded grams (4/4/9). */
  reTotaledCalories: number;
  validationError: string | null;
};

function toInt(value: string): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Custom macros as total calories + P/C/F percent split (◆3). All three percents
 * are independently editable and must total 100% (guarded by the builder); grams
 * are derived live and STORED as grams by the builder (the generate payload is
 * unchanged). The re-totaled actual calories are shown so the coach sees rounding
 * drift, and the total-% callout flags a split that doesn't add up.
 */
export function NutritionCustomMacrosSection({
  calories,
  onCaloriesChange,
  proteinPct,
  onProteinPctChange,
  carbPct,
  onCarbPctChange,
  fatPct,
  onFatPctChange,
  grams,
  reTotaledCalories,
  validationError,
}: NutritionCustomMacrosSectionProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Set a calorie total and macro split — the same targets apply to every day.
      </p>

      {/* Total calories */}
      <div className="space-y-1.5">
        <Label htmlFor="custom-calories" className="text-xs font-medium text-foreground">
          Total calories
        </Label>
        <Input
          id="custom-calories"
          type="number"
          inputMode="numeric"
          value={calories || ""}
          onChange={(e) => onCaloriesChange(toInt(e.target.value))}
          placeholder="e.g. 2000"
          className="h-9"
        />
      </div>

      {/* P / C / F percent split */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="custom-protein-pct" className="text-xs font-medium text-foreground">
            Protein %
          </Label>
          <Input
            id="custom-protein-pct"
            type="number"
            inputMode="numeric"
            value={proteinPct || ""}
            onChange={(e) => onProteinPctChange(toInt(e.target.value))}
            className="h-9"
          />
          <p className={cn(MONO_META_CLASS, "text-[10px]")}>= {grams.protein}g</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-carb-pct" className="text-xs font-medium text-foreground">
            Carb %
          </Label>
          <Input
            id="custom-carb-pct"
            type="number"
            inputMode="numeric"
            value={carbPct || ""}
            onChange={(e) => onCarbPctChange(toInt(e.target.value))}
            className="h-9"
          />
          <p className={cn(MONO_META_CLASS, "text-[10px]")}>= {grams.carbs}g</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-fat-pct" className="text-xs font-medium text-foreground">
            Fat %
          </Label>
          <Input
            id="custom-fat-pct"
            type="number"
            inputMode="numeric"
            value={fatPct || ""}
            onChange={(e) => onFatPctChange(toInt(e.target.value))}
            className="h-9"
          />
          <p className={cn(MONO_META_CLASS, "text-[10px]")}>= {grams.fat}g</p>
        </div>
      </div>

      {/* Total % + re-totaled actual calories */}
      <p className="text-[11px] text-[#93b0b4]">
        Split totals{" "}
        <span
          className={
            proteinPct + carbPct + fatPct === 100
              ? "text-[#0d9488]"
              : "text-[#d97706]"
          }
        >
          {proteinPct + carbPct + fatPct}%
        </span>{" "}
        · {reTotaledCalories} kcal from macros
      </p>

      {validationError && (
        <div className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg">
          <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
          <p className="text-xs text-foreground">{validationError}</p>
        </div>
      )}
    </div>
  );
}
