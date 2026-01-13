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
};

export const NutritionDayCard = memo(function NutritionDayCard({ dayTarget }: NutritionDayCardProps) {
  const hasActivities =
    dayTarget.trainingSessionCalories > 0 || dayTarget.externalActivityCalories > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "min-h-[100px] rounded-xl p-2 transition-all cursor-pointer overflow-hidden",
            dayTarget.isTrainingDay
              ? "bg-warning/5 border border-warning/20 hover:shadow-md hover:border-warning/30"
              : "bg-gray-50 border border-dashed border-gray-200 hover:shadow-md hover:border-gray-300"
          )}
        >
          <div className="flex flex-col h-full gap-1.5">
            {/* Calories */}
            <div className="text-center mb-1">
              <span className="text-lg xl:text-xl 2xl:text-2xl font-bold text-warning leading-tight">
                {dayTarget.calories.toLocaleString()}
              </span>
              <span className="text-[11px] text-gray-500 block">cal</span>
            </div>

            {/* Training/Rest Badge */}
            <div className="flex justify-center">
              {dayTarget.isTrainingDay ? (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] xl:text-[10px] font-medium bg-blue-50 text-blue-600 whitespace-nowrap">
                  <Dumbbell className="h-2 w-2 xl:h-2.5 xl:w-2.5 flex-shrink-0" />
                  <span className="hidden sm:inline">Training</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] xl:text-[10px] font-medium bg-gray-100 text-gray-500 whitespace-nowrap">
                  <Moon className="h-2 w-2 xl:h-2.5 xl:w-2.5 flex-shrink-0" />
                  <span className="hidden sm:inline">Rest</span>
                </span>
              )}
            </div>

            {/* Activity indicator */}
            {hasActivities && (
              <div className="text-center">
                <span className="text-[9px] xl:text-[10px] text-warning font-medium flex items-center justify-center gap-0.5">
                  <Flame className="h-2 w-2 xl:h-2.5 xl:w-2.5 flex-shrink-0" />
                  +{dayTarget.trainingSessionCalories + dayTarget.externalActivityCalories}
                </span>
              </div>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="w-64 p-0 bg-white rounded-lg shadow-lg"
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
  const hasExternalActivities =
    dayTarget.externalActivities && dayTarget.externalActivities.length > 0;

  return (
    <div className="text-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm text-gray-900">{dayTarget.dayLabel}</span>
          {dayTarget.isTrainingDay ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary/15 text-secondary">
              <Dumbbell className="h-3 w-3" />
              Training Day
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              <Moon className="h-3 w-3" />
              Rest Day
            </span>
          )}
        </div>
      </div>

      {/* Calories breakdown */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="text-center mb-2">
          <p className="text-2xl font-bold text-warning">
            {dayTarget.calories.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">total calories</p>
        </div>
        {(dayTarget.trainingSessionCalories > 0 || dayTarget.externalActivityCalories > 0) && (
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <span>Base: {dayTarget.baselineCalories.toLocaleString()}</span>
            <span>+</span>
            <span className="flex items-center gap-1 text-warning font-medium">
              <Flame className="h-3 w-3" />
              {dayTarget.trainingSessionCalories + dayTarget.externalActivityCalories}
            </span>
          </div>
        )}
      </div>

      {/* Macro breakdown */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-sm font-bold text-primary">{dayTarget.proteinG}g</p>
            <p className="text-[10px] text-gray-500">
              Protein ({dayTarget.proteinPercent}%)
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-success">{dayTarget.carbsG}g</p>
            <p className="text-[10px] text-gray-500">
              Carbs ({dayTarget.carbsPercent}%)
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-warning">{dayTarget.fatG}g</p>
            <p className="text-[10px] text-gray-500">
              Fat ({dayTarget.fatPercent}%)
            </p>
          </div>
        </div>
      </div>

      {/* Activities */}
      {(hasTrainingSessions || hasExternalActivities) && (
        <div className="px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-1">Activities:</p>
          {hasTrainingSessions &&
            dayTarget.trainingSessions?.map((session, idx) => (
              <div
                key={`training-${idx}`}
                className="flex justify-between text-xs text-secondary"
              >
                <span className="flex items-center gap-1">
                  <Dumbbell className="h-3 w-3" />
                  {session.name}
                </span>
                <span>+{session.calories} cal</span>
              </div>
            ))}
          {hasExternalActivities &&
            dayTarget.externalActivities?.map((activity, idx) => (
              <div
                key={`external-${idx}`}
                className="flex justify-between text-xs text-warning"
              >
                <span className="flex items-center gap-1">
                  <Flame className="h-3 w-3" />
                  {activity.name}
                </span>
                <span>+{activity.calories} cal</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
