"use client";

import { memo } from "react";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Dumbbell, Moon, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

type NutritionDayCardProps = {
  dayTarget: DailyNutritionTargets;
  index?: number;
};

export const NutritionDayCard = memo(function NutritionDayCard({ dayTarget, index = 0 }: NutritionDayCardProps) {
  const surplusCalories = dayTarget.trainingSessionCalories;
  const isTraining = dayTarget.isTrainingDay;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "min-h-[170px] rounded-[6px] p-3 cursor-pointer transition-all duration-200 animate-card-in flex flex-col justify-between",
            isTraining
              ? "bg-white border border-[rgba(13,148,136,0.08)] hover:-translate-y-px hover:shadow-sm"
              : "bg-transparent border border-dashed border-[rgba(13,148,136,0.08)] hover:bg-white/60"
          )}
          style={{ animationDelay: `${index * 40}ms` }}
        >
          {/* Top section */}
          <div>
            {/* Day + badge row */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-[#93b0b4] uppercase">
                {dayTarget.dayLabel.slice(0, 3)}
              </span>
              {isTraining ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[9px] font-semibold bg-[#0d9488] text-white uppercase">
                  Train
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[9px] font-medium bg-[#e6edec] text-[#93b0b4] uppercase">
                  Rest
                </span>
              )}
            </div>

            {/* Calorie number */}
            <p className={cn(
              "text-[24px] font-bold leading-tight",
              isTraining ? "text-[#0c1a1e]" : "text-[#93b0b4]"
            )}>
              {dayTarget.calories.toLocaleString()}
            </p>
            <p className="text-[10px] text-[#93b0b4]">kcal</p>
          </div>

          {/* Bottom section */}
          <div>
            {/* Stacked macro bar */}
            <div className={cn(
              "flex h-[5px] rounded-full overflow-hidden mt-2.5",
              !isTraining && "opacity-50"
            )}>
              <div className="bg-protein" style={{ width: `${dayTarget.proteinPercent}%` }} />
              <div className="bg-carbs" style={{ width: `${dayTarget.carbsPercent}%` }} />
              <div className="bg-fat" style={{ width: `${dayTarget.fatPercent}%` }} />
            </div>

            {/* Macro values */}
            <p className={cn(
              "text-[10px] font-mono-display mt-1.5 flex gap-1.5",
              !isTraining && "opacity-70"
            )}>
              <span className="text-protein">{dayTarget.proteinG}p</span>
              <span className="text-carbs">{dayTarget.carbsG}c</span>
              <span className="text-fat">{dayTarget.fatG}f</span>
            </p>

            {/* Surplus / dash slot */}
            {isTraining && surplusCalories > 0 ? (
              <p className="text-[10px] text-surplus font-medium mt-1.5 flex items-center gap-0.5">
                <span className="text-[8px] leading-none">&#9650;</span>
                +{surplusCalories}
              </p>
            ) : (
              <p className="text-[10px] text-[#93b0b4] mt-1.5">&mdash;</p>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="w-64 p-0 bg-white rounded-[6px] shadow-lg border border-[rgba(13,148,136,0.08)]"
        sideOffset={4}
      >
        <NutritionDayTooltip dayTarget={dayTarget} />
      </TooltipContent>
    </Tooltip>
  );
});

type NutritionDayTooltipProps = {
  dayTarget: DailyNutritionTargets;
};

function NutritionDayTooltip({ dayTarget }: NutritionDayTooltipProps) {
  const hasTrainingSessions = dayTarget.trainingSessions && dayTarget.trainingSessions.length > 0;

  return (
    <div className="text-[#0c1a1e]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[rgba(13,148,136,0.08)] bg-[#f0f5f4] rounded-t-[6px]">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm text-[#0c1a1e]">{dayTarget.dayLabel}</span>
          {dayTarget.isTrainingDay ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] text-xs font-medium bg-[#0d9488] text-white">
              <Dumbbell className="h-3 w-3" />
              Training Day
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] text-xs font-medium bg-[#e6edec] text-[#93b0b4]">
              <Moon className="h-3 w-3" />
              Rest Day
            </span>
          )}
        </div>
      </div>

      {/* Calories breakdown */}
      <div className="px-4 py-3 border-b border-[rgba(13,148,136,0.08)]">
        <div className="text-center mb-2">
          <p className="text-2xl font-semibold text-[#0c1a1e]">
            {dayTarget.calories.toLocaleString()}
          </p>
          <p className="text-xs text-[#93b0b4]">total calories</p>
        </div>
        {dayTarget.trainingSessionCalories > 0 && (
          <div className="flex items-center justify-center gap-2 text-xs text-[#93b0b4]">
            <span>Base: {dayTarget.baselineCalories.toLocaleString()}</span>
            <span>+</span>
            <span className="flex items-center gap-1 text-surplus font-medium">
              <Flame className="h-3 w-3" />
              {dayTarget.trainingSessionCalories}
            </span>
          </div>
        )}
      </div>

      {/* Macro breakdown */}
      <div className="px-4 py-3 border-b border-[rgba(13,148,136,0.08)]">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-sm font-semibold text-protein">{dayTarget.proteinG}g</p>
            <p className="text-[10px] text-[#93b0b4]">Protein ({dayTarget.proteinPercent}%)</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-carbs">{dayTarget.carbsG}g</p>
            <p className="text-[10px] text-[#93b0b4]">Carbs ({dayTarget.carbsPercent}%)</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-fat">{dayTarget.fatG}g</p>
            <p className="text-[10px] text-[#93b0b4]">Fat ({dayTarget.fatPercent}%)</p>
          </div>
        </div>
      </div>

      {/* Activities */}
      {hasTrainingSessions && (
        <div className="px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-[#93b0b4] mb-1">Activities:</p>
          {dayTarget.trainingSessions?.map((session, idx) => (
            <div key={`training-${idx}`} className="flex items-center gap-1 text-xs text-[#0d9488]">
              <Dumbbell className="h-3 w-3" />
              {session.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
