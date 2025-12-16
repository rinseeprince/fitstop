"use client";

import type { DailyNutritionTargets, DayOfWeek } from "@/utils/nutrition-helpers";
import { NutritionDayCard } from "./nutrition-day-card";

const DAYS_OF_WEEK: { value: DayOfWeek; label: string }[] = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

type WeeklyNutritionViewProps = {
  targets: DailyNutritionTargets[];
};

export function WeeklyNutritionView({ targets }: WeeklyNutritionViewProps) {
  // Create a map for quick lookup
  const targetsByDay = new Map(targets.map((t) => [t.day, t]));

  return (
    <div className="space-y-4">
      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day.value}
            className="text-center text-sm font-medium text-muted-foreground py-2"
          >
            {day.label}
          </div>
        ))}
      </div>

      {/* Day Cards */}
      <div className="grid grid-cols-7 gap-1">
        {DAYS_OF_WEEK.map((day) => {
          const dayTarget = targetsByDay.get(day.value);

          if (!dayTarget) {
            return (
              <div
                key={day.value}
                className="min-h-[100px] rounded-lg border border-dashed bg-muted/30 flex items-center justify-center"
              >
                <span className="text-xs text-muted-foreground">No data</span>
              </div>
            );
          }

          return <NutritionDayCard key={day.value} dayTarget={dayTarget} />;
        })}
      </div>
    </div>
  );
}
