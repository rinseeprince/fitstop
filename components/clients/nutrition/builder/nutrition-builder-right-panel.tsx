"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionWarnings } from "../nutrition-warnings";
import { Button } from "@/components/ui/button";
import { Apple, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

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
          <p className={STAT_LABEL_DARK_CLASS}>Weekly Total</p>
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[32px] leading-tight mt-1")}>
            {builder.weeklyTotal.toLocaleString()}
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.35)]">kcal</p>
          <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.35)] mt-auto pt-2")}>
            {avgCalories.toLocaleString()}/day &middot; {trainingCount}T {restCount}R
          </p>
        </div>

        {/* Protein */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#2d8fb5]" />
            <p className={STAT_LABEL_DARK_CLASS}>Protein</p>
          </div>
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
            {totalProtein.toLocaleString()}<span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
          </p>
          <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>{avgProtein}g/day</p>
        </div>

        {/* Carbs */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#c8923a]" />
            <p className={STAT_LABEL_DARK_CLASS}>Carbs</p>
          </div>
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
            {totalCarbs.toLocaleString()}<span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
          </p>
          <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>{avgCarbs}g/day</p>
        </div>

        {/* Fat */}
        <div className="flex flex-col pl-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#c06060]" />
            <p className={STAT_LABEL_DARK_CLASS}>Fat</p>
          </div>
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
            {totalFat.toLocaleString()}<span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
          </p>
          <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>{avgFat}g/day</p>
        </div>
      </div>
    </div>
  );
});
