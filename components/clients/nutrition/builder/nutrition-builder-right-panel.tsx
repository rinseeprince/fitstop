"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { WeeklyNutritionView } from "../display/weekly-nutrition-view";
import { NutritionWarnings } from "../nutrition-warnings";
import { Button } from "@/components/ui/button";
import { Apple, Loader2, Sparkles } from "lucide-react";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();

  // Loading state for training plan
  if (builder.isLoadingTrainingPlan) {
    return (
      <div className="flex items-center justify-center h-full bg-white/50 rounded-[6px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#93b0b4]" />
      </div>
    );
  }

  // Empty state - no nutrition plan
  if (!builder.hasPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center bg-white rounded-[6px]">
        <div className="w-16 h-16 rounded-full bg-[#e6f5f3] flex items-center justify-center mb-4">
          <Apple className="h-8 w-8 text-[#0d9488]" />
        </div>
        <h3 className="text-lg font-semibold text-[#0c1a1e] mb-2">No nutrition plan yet</h3>
        <p className="text-sm text-[#93b0b4] max-w-sm mb-6">
          Generate a customized nutrition plan based on your client&apos;s goals, activity level, and training schedule.
        </p>
        {onOpenSettings && (
          <Button
            onClick={onOpenSettings}
            className="bg-[#0f2027] hover:bg-[#0f2027]/90 rounded-[6px]"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Plan
          </Button>
        )}
      </div>
    );
  }

  // Macro aggregates from weekly targets
  const weeklyTargets = builder.weeklyTargets ?? [];
  const totalProtein = weeklyTargets.reduce((s, d) => s + d.proteinG, 0);
  const totalCarbs = weeklyTargets.reduce((s, d) => s + d.carbsG, 0);
  const totalFat = weeklyTargets.reduce((s, d) => s + d.fatG, 0);
  const days = weeklyTargets.length || 7;
  const avgCalories = Math.round(builder.weeklyTotal / days);
  const avgProtein = Math.round(totalProtein / days);
  const avgCarbs = Math.round(totalCarbs / days);
  const avgFat = Math.round(totalFat / days);
  const trainingCount = weeklyTargets.filter(d => d.isTrainingDay).length;
  const restCount = days - trainingCount;

  // Plan exists - show content
  return (
    <div className="flex flex-col gap-4">
      {/* Warnings */}
      {builder.warnings.length > 0 && (
        <NutritionWarnings warnings={builder.warnings} />
      )}

      {/* Weekly overview strip */}
      <div className="grid grid-cols-4 gap-3">
        {/* Dark card: Weekly total */}
        <div className="bg-[#0f2027] text-white rounded-[6px] p-4 flex flex-col">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Weekly Total</p>
          <p className="text-[30px] font-bold leading-tight mt-1">
            {builder.weeklyTotal.toLocaleString()}
          </p>
          <p className="text-xs text-[#93b0b4]">kcal</p>
          <p className="text-xs text-[#93b0b4] font-mono-display mt-auto pt-2">
            {avgCalories.toLocaleString()}/day &middot; {trainingCount}T {restCount}R
          </p>
        </div>

        {/* Protein card */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[14px] rounded-full bg-protein" />
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Protein</p>
          </div>
          <p className="text-2xl font-bold text-[#0c1a1e]">
            {totalProtein.toLocaleString()}<span className="text-base font-medium text-[#93b0b4]">g</span>
          </p>
          <p className="text-xs text-[#93b0b4] font-mono-display mt-1">{avgProtein}g/day avg</p>
        </div>

        {/* Carbs card */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[14px] rounded-full bg-carbs" />
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Carbs</p>
          </div>
          <p className="text-2xl font-bold text-[#0c1a1e]">
            {totalCarbs.toLocaleString()}<span className="text-base font-medium text-[#93b0b4]">g</span>
          </p>
          <p className="text-xs text-[#93b0b4] font-mono-display mt-1">{avgCarbs}g/day avg</p>
        </div>

        {/* Fat card */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[14px] rounded-full bg-fat" />
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Fat</p>
          </div>
          <p className="text-2xl font-bold text-[#0c1a1e]">
            {totalFat.toLocaleString()}<span className="text-base font-medium text-[#93b0b4]">g</span>
          </p>
          <p className="text-xs text-[#93b0b4] font-mono-display mt-1">{avgFat}g/day avg</p>
        </div>
      </div>

      {/* Daily breakdown section header */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium whitespace-nowrap">Daily Breakdown</span>
        <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
        <div className="flex items-center gap-2.5">
          <span className="w-3 h-1 rounded-full bg-protein" /><span className="text-[10px] text-[#93b0b4]">P</span>
          <span className="w-3 h-1 rounded-full bg-carbs" /><span className="text-[10px] text-[#93b0b4]">C</span>
          <span className="w-3 h-1 rounded-full bg-fat" /><span className="text-[10px] text-[#93b0b4]">F</span>
        </div>
      </div>

      {/* Day cards */}
      {builder.weeklyTargets ? (
        <WeeklyNutritionView targets={builder.weeklyTargets} />
      ) : builder.nutritionData?.customMacrosEnabled ? (
        <CustomMacrosDisplay
          calories={builder.nutritionData?.calorieTarget || 0}
          protein={builder.nutritionData?.proteinTargetG || 0}
          carbs={builder.nutritionData?.carbTargetG || 0}
          fat={builder.nutritionData?.fatTargetG || 0}
        />
      ) : null}
    </div>
  );
});

type CustomMacrosDisplayProps = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function CustomMacrosDisplay({ calories, protein, carbs, fat }: CustomMacrosDisplayProps) {
  return (
    <div className="bg-white rounded-[6px] p-8 text-center">
      <div className="text-4xl font-semibold text-[#0c1a1e]">{calories.toLocaleString()}</div>
      <div className="text-sm text-[#93b0b4] mt-2">calories per day (custom macros)</div>
      <div className="grid grid-cols-3 gap-4 mt-6 pt-6">
        <div className="text-center bg-protein/10 rounded-[6px] p-4">
          <div className="text-2xl font-semibold text-protein">{protein}g</div>
          <div className="text-xs text-[#93b0b4] mt-1">Protein</div>
        </div>
        <div className="text-center bg-carbs/10 rounded-[6px] p-4">
          <div className="text-2xl font-semibold text-carbs">{carbs}g</div>
          <div className="text-xs text-[#93b0b4] mt-1">Carbs</div>
        </div>
        <div className="text-center bg-fat/10 rounded-[6px] p-4">
          <div className="text-2xl font-semibold text-fat">{fat}g</div>
          <div className="text-xs text-[#93b0b4] mt-1">Fat</div>
        </div>
      </div>
      <p className="text-xs text-fat mt-4 font-medium">Custom macros active - same targets each day</p>
    </div>
  );
}
