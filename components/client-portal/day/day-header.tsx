"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getDateDaysFrom,
  getTodayDateString,
} from "@/lib/date-helpers";

type DayHeaderProps = {
  date: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
};

function formatDayLabel(date: string): string {
  const today = getTodayDateString();
  if (date === today) return "Today";

  const todayMidnight = new Date(today + "T00:00:00");
  if (date === getDateDaysFrom(todayMidnight, -1)) return "Yesterday";
  if (date === getDateDaysFrom(todayMidnight, 1)) return "Tomorrow";

  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DayHeader({ date, onPrev, onNext, onToday }: DayHeaderProps) {
  const isToday = date === getTodayDateString();

  return (
    <div className="flex items-center justify-between py-3">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        onClick={onPrev}
      >
        <ChevronLeft strokeWidth={1.5} />
      </Button>

      <div className="flex flex-col items-center">
        <div
          className="text-lg font-semibold text-foreground"
          aria-live="polite"
        >
          {formatDayLabel(date)}
        </div>
        <Button
          variant="link"
          size="sm"
          disabled={isToday}
          onClick={onToday}
          className="h-auto px-0 py-0 text-xs"
        >
          Jump to today
        </Button>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        onClick={onNext}
      >
        <ChevronRight strokeWidth={1.5} />
      </Button>
    </div>
  );
}
