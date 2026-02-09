"use client";

import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { ClientNutritionDayCard } from "./client-nutrition-day-card";

type VerticalNutritionViewProps = {
  targets: DailyNutritionTargets[];
};

export function VerticalNutritionView({ targets }: VerticalNutritionViewProps) {
  // Sort targets by day order (Monday = 0, Sunday = 6)
  const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const sortedTargets = [...targets].sort((a, b) => {
    return dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">This Week&apos;s Nutrition Targets</h2>
      {sortedTargets.map((dayTarget) => (
        <ClientNutritionDayCard
          key={dayTarget.day}
          dayTarget={dayTarget}
        />
      ))}
    </div>
  );
}