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
    <div className="space-y-2">
      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1.5 xl:gap-2 mb-2">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day.value} className="text-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {day.label}
            </span>
          </div>
        ))}
      </div>

      {/* Day Cards */}
      <div className="grid grid-cols-7 gap-1.5 xl:gap-2">
        {DAYS_OF_WEEK.map((day) => {
          const dayTarget = targetsByDay.get(day.value);

          if (!dayTarget) {
            return (
              <div
                key={day.value}
                className="min-h-[100px] bg-muted/50 border border-dashed border-border rounded-lg flex items-center justify-center"
              >
                <span className="text-sm text-muted-foreground">No data</span>
              </div>
            );
          }

          return <NutritionDayCard key={day.value} dayTarget={dayTarget} />;
        })}
      </div>
    </div>
  );
}
