"use client";

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
      <div className="bg-gray-50 rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (!trainingPlan) {
    return (
      <div className="bg-gray-50 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Dumbbell className="h-4 w-4 text-gray-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">No active training plan</p>
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
    <div className="bg-secondary/10 rounded-xl p-5 border border-secondary/20">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
          <Flame className="h-4 w-4 text-teal-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">Training Calories</h4>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-teal-50 text-teal-600">
              Auto
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-white rounded-xl p-3 shadow-sm">
              <p className="text-xl font-bold text-teal-600">+{dailyCalories}</p>
              <p className="text-xs text-gray-500">cal/day avg</p>
            </div>
            <div className="bg-white rounded-xl p-3 shadow-sm">
              <p className="text-xl font-bold text-teal-600">{weeklyCalories}</p>
              <p className="text-xs text-gray-500">cal/week</p>
            </div>
          </div>
          {caloriesByDay && (
            <div className="mt-4 pt-4">
              <div className="flex flex-wrap gap-1.5">
                {days.map((day) => {
                  const cals = caloriesByDay[day as keyof typeof caloriesByDay] || 0;
                  const shortDay = day.slice(0, 2).toUpperCase();
                  return (
                    <div
                      key={day}
                      className={`text-[10px] px-2.5 py-1 rounded-lg font-medium ${
                        cals > 0 ? "bg-teal-100 text-teal-600" : "bg-gray-100 text-gray-500"
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
