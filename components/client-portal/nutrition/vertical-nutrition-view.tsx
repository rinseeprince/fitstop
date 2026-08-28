"use client";

import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { ClientNutritionDayCard } from "./client-nutrition-day-card";

type VerticalNutritionViewProps = {
  targets: DailyNutritionTargets[];
};

export function VerticalNutritionView({ targets }: VerticalNutritionViewProps) {
  // BY DATE, never by weekday name. The client's week ends on their check-in
  // day, so it can start on any weekday — a Monday-first sort showed a
  // Saturday-to-Friday client their week beginning three days in, with its two
  // earliest days last on the page. The server sends the week in order and each
  // day carries its date; this sorts on that date rather than trusting array
  // order, the same way the training page sorts on the order index the server
  // gives it.
  const sortedTargets = [...targets].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "")
  );

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