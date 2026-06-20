"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { WeeklyNutritionView } from "../display/weekly-nutrition-view";
import { NutritionWarnings } from "../nutrition-warnings";
import { Button } from "@/components/ui/button";
import { Apple, ChevronDown, Loader2, Sparkles } from "lucide-react";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();

  // Loading state for training plan or nutrition data
  if (builder.isLoadingTrainingPlan || builder.isLoadingNutrition) {
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

      {/* Weekly overview strip - unified dark card */}
      <div className="bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-[1fr_1fr_1fr_1fr]">
        {/* Weekly total */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">Weekly Total</p>
          <p className="text-[32px] font-bold leading-tight mt-1 text-white">
            {builder.weeklyTotal.toLocaleString()}
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.35)]">kcal</p>
          <p className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono-display mt-auto pt-2">
            {avgCalories.toLocaleString()}/day &middot; {trainingCount}T {restCount}R
          </p>
        </div>

        {/* Protein */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#2d8fb5]" />
            <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.4)] font-medium">Protein</p>
          </div>
          <p className="text-[22px] font-bold text-white mt-1">
            {totalProtein.toLocaleString()}<span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">{avgProtein}g/day</p>
        </div>

        {/* Carbs */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#c8923a]" />
            <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.4)] font-medium">Carbs</p>
          </div>
          <p className="text-[22px] font-bold text-white mt-1">
            {totalCarbs.toLocaleString()}<span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">{avgCarbs}g/day</p>
        </div>

        {/* Fat */}
        <div className="flex flex-col pl-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#c06060]" />
            <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.4)] font-medium">Fat</p>
          </div>
          <p className="text-[22px] font-bold text-white mt-1">
            {totalFat.toLocaleString()}<span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">{avgFat}g/day</p>
        </div>
      </div>

      {/* Typical week — demoted from the primary surface to an optional
          disclosure (collapsed by default). The nutrition calendar is now the
          primary day-by-day view; this stays as an at-a-glance weekly summary. */}
      <details className="group">
        <summary className="flex items-center gap-3 mt-2 cursor-pointer list-none select-none">
          <span className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium whitespace-nowrap">Typical week</span>
          <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
          <span className="flex items-center gap-2.5">
            <span className="w-3 h-1 rounded-full bg-protein" /><span className="text-[10px] text-[#93b0b4]">P</span>
            <span className="w-3 h-1 rounded-full bg-carbs" /><span className="text-[10px] text-[#93b0b4]">C</span>
            <span className="w-3 h-1 rounded-full bg-fat" /><span className="text-[10px] text-[#93b0b4]">F</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-[#93b0b4] transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3">
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
      </details>
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
