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
  const targetsByDay = new Map(targets.map((t) => [t.day, t]));

  return (
    <div className="grid grid-cols-7 gap-2">
      {DAYS_OF_WEEK.map((day, index) => {
        const dayTarget = targetsByDay.get(day.value);

        if (!dayTarget) {
          return (
            <div
              key={day.value}
              className="min-h-[170px] border border-dashed border-[rgba(13,148,136,0.08)] rounded-[6px] flex items-center justify-center"
            >
              <span className="text-sm text-[#93b0b4]">No data</span>
            </div>
          );
        }

        return <NutritionDayCard key={day.value} dayTarget={dayTarget} index={index} />;
      })}
    </div>
  );
}
