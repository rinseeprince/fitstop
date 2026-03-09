"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { HabitChartCard } from "./habit-chart-card";
import { useHabitLogs, type DateRangeFilter } from "@/hooks/use-habit-logs";
import type { DailyHabit } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";

interface HabitWithStats extends DailyHabit {
  stats?: HabitStats;
}

type HabitsGridProps = {
  habits: HabitWithStats[];
  clientId: string;
  selectedHabitId: string | null;
};

const DATE_RANGE_OPTIONS: { value: DateRangeFilter; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

export const HabitsGrid = ({ habits, clientId, selectedHabitId }: HabitsGridProps) => {
  const [dateRange, setDateRange] = useState<DateRangeFilter>("30d");
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  const {
    chartData,
    isLoading,
    error,
    getHabitChartData,
    calculateAverageValue,
    calculateCompletionRate,
  } = useHabitLogs(clientId, dateRange);
  
  useEffect(() => {
    if (selectedHabitId) {
      const cardEl = cardRefs.current.get(selectedHabitId);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [selectedHabitId]);
  
  const setCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      cardRefs.current.set(id, el);
    } else {
      cardRefs.current.delete(id);
    }
  };
  
  if (habits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">No habits to display</p>
          <p className="text-sm text-muted-foreground">
            Create a habit using the sidebar to get started
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Habit Analytics</h2>
        
        <div className="bg-muted p-1 rounded-lg inline-flex">
          {DATE_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setDateRange(option.value)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                dateRange === option.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading habit analytics...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <p className="font-medium">Failed to load analytics</p>
          <p className="text-sm text-muted-foreground">
            {error.message || "An error occurred while loading habit data"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {habits.map((habit) => {
            const chartPoints = getHabitChartData(habit.id);
            const averageValue = calculateAverageValue(habit.id);
            const completionRate7d = calculateCompletionRate(habit.id, 7);
            const completionRate30d = calculateCompletionRate(habit.id, 30);
            
            return (
              <HabitChartCard
                key={habit.id}
                habit={habit}
                chartData={chartPoints}
                averageValue={averageValue}
                completionRate7d={completionRate7d}
                completionRate30d={completionRate30d}
                isHighlighted={habit.id === selectedHabitId}
                onRef={setCardRef(habit.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}