"use client";

import { memo } from "react";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { Badge } from "@/components/ui/badge";
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
            "min-h-[100px] rounded-lg border p-2 transition-all cursor-pointer",
            "hover:ring-2 hover:ring-primary/50 hover:shadow-sm",
            dayTarget.isTrainingDay
              ? "bg-green-50/50 border-green-200"
              : "bg-muted/30 border-dashed"
          )}
        >
          <div className="flex flex-col h-full gap-2">
            {/* Calories */}
            <div className="text-center">
              <p className="text-lg font-bold text-primary">
                {dayTarget.calories.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">cal</p>
            </div>

            {/* Training/Rest Badge */}
            <div className="flex justify-center mt-auto">
              {dayTarget.isTrainingDay ? (
                <Badge
                  variant="default"
                  className="text-[10px] bg-green-600 hover:bg-green-700 px-1.5 py-0"
                >
                  <Dumbbell className="h-2.5 w-2.5 mr-0.5" />
                  Training
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground px-1.5 py-0"
                >
                  <Moon className="h-2.5 w-2.5 mr-0.5" />
                  Rest
                </Badge>
              )}
            </div>

            {/* Activity indicator */}
            {hasActivities && (
              <div className="text-center">
                <span className="text-[10px] text-orange-600 flex items-center justify-center gap-0.5">
                  <Flame className="h-2.5 w-2.5" />
                  +{dayTarget.trainingSessionCalories + dayTarget.externalActivityCalories}
                </span>
              </div>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="w-64 p-0 bg-white border shadow-lg"
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
    <div className="text-foreground">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">{dayTarget.dayLabel}</span>
          {dayTarget.isTrainingDay ? (
            <Badge variant="default" className="text-xs bg-green-600">
              <Dumbbell className="h-3 w-3 mr-1" />
              Training Day
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              <Moon className="h-3 w-3 mr-1" />
              Rest Day
            </Badge>
          )}
        </div>
      </div>

      {/* Calories breakdown */}
      <div className="px-3 py-2 border-b">
        <div className="text-center mb-2">
          <p className="text-2xl font-bold text-primary">
            {dayTarget.calories.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">total calories</p>
        </div>
        {(dayTarget.trainingSessionCalories > 0 || dayTarget.externalActivityCalories > 0) && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Base: {dayTarget.baselineCalories.toLocaleString()}</span>
            <span>+</span>
            <span className="flex items-center gap-1 text-orange-600">
              <Flame className="h-3 w-3" />
              {dayTarget.trainingSessionCalories + dayTarget.externalActivityCalories}
            </span>
          </div>
        )}
      </div>

      {/* Macro breakdown */}
      <div className="px-3 py-2 border-b">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-sm font-bold text-blue-500">{dayTarget.proteinG}g</p>
            <p className="text-[10px] text-muted-foreground">
              Protein ({dayTarget.proteinPercent}%)
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-green-500">{dayTarget.carbsG}g</p>
            <p className="text-[10px] text-muted-foreground">
              Carbs ({dayTarget.carbsPercent}%)
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-amber-500">{dayTarget.fatG}g</p>
            <p className="text-[10px] text-muted-foreground">
              Fat ({dayTarget.fatPercent}%)
            </p>
          </div>
        </div>
      </div>

      {/* Activities */}
      {(hasTrainingSessions || hasExternalActivities) && (
        <div className="px-3 py-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-1">Activities:</p>
          {hasTrainingSessions &&
            dayTarget.trainingSessions?.map((session, idx) => (
              <div
                key={`training-${idx}`}
                className="flex justify-between text-xs text-green-700"
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
                className="flex justify-between text-xs text-orange-700"
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
