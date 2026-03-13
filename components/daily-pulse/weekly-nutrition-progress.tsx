"use client";

import { useEffect, useState } from "react";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";

interface WeeklyNutritionProgressProps {
  summary?: WeeklyNutritionSummary | null;
}

export function WeeklyNutritionProgress({ summary: propSummary }: WeeklyNutritionProgressProps = {}) {
  const [fetchedSummary, setFetchedSummary] = useState<WeeklyNutritionSummary | null>(null);

  // Only fetch if no summary provided via props (standalone usage like nutrition plan page)
  useEffect(() => {
    if (propSummary !== undefined) return;
    async function fetchWeekly() {
      try {
        const res = await fetch("/api/client/weekly-nutrition?latest=true");
        if (!res.ok) return;
        const data = await res.json();
        if (data.data) setFetchedSummary(data.data);
      } catch (err) {
        console.error("Failed to fetch weekly nutrition summary:", err instanceof Error ? err.message : "Unknown error");
      }
    }
    fetchWeekly();
  }, [propSummary]);

  const summary = propSummary !== undefined ? propSummary : fetchedSummary;

  if (!summary || summary.totalCaloriesConsumed == null || summary.totalTargetCalories == null) {
    return null;
  }

  const pct = Math.min(
    Math.round((summary.totalCaloriesConsumed / summary.totalTargetCalories) * 100),
    200
  );
  const barWidth = Math.min(pct, 100);

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">This week</span>
        <span className="font-medium">
          {summary.totalCaloriesConsumed.toLocaleString()} / {summary.totalTargetCalories.toLocaleString()} cal
          {summary.daysLogged > 0 && (
            <span className="text-muted-foreground ml-1">
              ({summary.daysLogged} of {summary.daysInWeek} days)
            </span>
          )}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className="h-2 rounded-full transition-all bg-success"
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        <span>{pct}% of weekly target</span>
      </div>
    </div>
  );
}
