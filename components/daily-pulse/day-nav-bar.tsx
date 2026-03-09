"use client";

import { cn } from "@/lib/utils";
import type { DailyLog } from "@/types/daily-log";

interface DayNavBarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  dailyLogs: Pick<DailyLog, "date" | "id">[];
  today: string;
}

const DAY_ABBREVIATIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DayNavBar({ selectedDate, onSelectDate, dailyLogs, today }: DayNavBarProps) {
  // Get the week containing the selected date
  const getWeekDays = (dateString: string): string[] => {
    const date = new Date(dateString + 'T00:00:00');
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Get Monday
    date.setDate(diff);
    
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(date);
      currentDate.setDate(date.getDate() + i);
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const dayNum = String(currentDate.getDate()).padStart(2, '0');
      days.push(`${year}-${month}-${dayNum}`);
    }
    return days;
  };

  const weekDays = getWeekDays(today);
  
  // Create a set of dates that have logs for O(1) lookup
  const datesWithLogs = new Set(dailyLogs.map(log => log.date));

  const getDayLabel = (dateString: string, index: number) => {
    const date = new Date(dateString + 'T00:00:00');
    const dayNumber = date.getDate();
    return {
      abbreviation: DAY_ABBREVIATIONS[index],
      number: dayNumber
    };
  };

  const isFutureDate = (dateString: string): boolean => {
    return dateString > today;
  };

  return (
    <div className="flex justify-between mb-4">
      {weekDays.map((date, index) => {
        const { abbreviation, number } = getDayLabel(date, index);
        const hasLog = datesWithLogs.has(date);
        const isToday = date === today;
        const isSelected = date === selectedDate;
        const isFuture = isFutureDate(date);

        return (
          <button
            key={date}
            disabled={isFuture}
            onClick={() => onSelectDate(date)}
            className={cn(
              "flex flex-col items-center justify-center",
              "w-10 h-10 rounded-full",
              "transition-all duration-200",
              "text-xs font-medium",
              // Base state - empty circle
              !hasLog && !isSelected && !isFuture && "border-2 border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/50",
              // Has log - filled circle
              hasLog && !isSelected && "bg-success/10 text-success border-2 border-success/20 hover:bg-success/20",
              // Selected state - primary filled
              isSelected && "bg-primary text-primary-foreground border-2 border-primary hover:bg-primary/90",
              // Future date - disabled
              isFuture && "opacity-30 cursor-not-allowed border border-muted-foreground/10",
              // Today indicator - special ring
              isToday && !isSelected && "ring-1 ring-primary ring-offset-1"
            )}
          >
            <span className="leading-none text-[10px]">
              {abbreviation}
            </span>
            <span className="leading-none font-semibold">
              {number}
            </span>
          </button>
        );
      })}
    </div>
  );
}