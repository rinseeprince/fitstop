"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionWarnings } from "../nutrition-warnings";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HEADER_EYEBROW_CLASS,
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

  // Empty state — the training tab's no-plan hero anatomy verbatim
  // (training-plan-hero.tsx empty branch): eyebrow + muted title, hairline,
  // then the lens-row register's active-chip primary. Text-only, no icons.
  if (!builder.hasPlan) {
    return (
      <div className="rounded-[6px] bg-[#0f2027] px-5 py-[18px]">
        <div className="min-w-0">
          <p className={HEADER_EYEBROW_CLASS}>Nutrition plan</p>
          <h2 className="mt-0.5 truncate text-[15px] font-medium text-[rgba(255,255,255,0.4)]">
            No active nutrition plan
          </h2>
        </div>
        <div className="mt-3 flex items-center gap-1 border-t border-[rgba(255,255,255,0.06)] pt-3">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="rounded-[4px] bg-[rgba(13,148,136,0.15)] px-2 py-1 text-[11px] font-medium text-[#0d9488] transition-colors"
            >
              Generate plan
            </button>
          )}
        </div>
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
