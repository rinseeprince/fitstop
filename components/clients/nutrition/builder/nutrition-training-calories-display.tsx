"use client";

import { Badge } from "@/components/ui/badge";
import { Flame, Dumbbell } from "lucide-react";
import type { TrainingPlan } from "@/types/training";

type NutritionTrainingCaloriesDisplayProps = {
  trainingPlan: TrainingPlan | null;
  isLoading: boolean;
  dailyCalories: number;
  weeklyCalories: number;
  caloriesByDay: Record<string, number> | null;
};

export function NutritionTrainingCaloriesDisplay({
  trainingPlan,
  isLoading,
  dailyCalories,
  weeklyCalories,
  caloriesByDay,
}: NutritionTrainingCaloriesDisplayProps) {
  if (isLoading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (!trainingPlan) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Dumbbell className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-gray-700">No active training plan</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Training calories will be calculated automatically when you create a training plan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  return (
    <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <Flame className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-orange-900">Training Calories</h4>
            <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">
              Auto
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-orange-700">+{dailyCalories}</p>
              <p className="text-[10px] text-orange-600">cal/day avg</p>
            </div>
            <div>
              <p className="text-lg font-bold text-orange-700">{weeklyCalories}</p>
              <p className="text-[10px] text-orange-600">cal/week</p>
            </div>
          </div>
          {caloriesByDay && (
            <div className="mt-2 pt-2 border-t border-orange-200">
              <div className="flex flex-wrap gap-1">
                {days.map((day) => {
                  const cals = caloriesByDay[day as keyof typeof caloriesByDay] || 0;
                  const shortDay = day.slice(0, 2).toUpperCase();
                  return (
                    <div
                      key={day}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        cals > 0 ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {shortDay}: {cals > 0 ? `+${cals}` : "-"}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
