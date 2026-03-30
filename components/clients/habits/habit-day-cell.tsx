"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyHabitDayStatus } from "@/types/history";

type HabitDayCellProps = {
  status: WeeklyHabitDayStatus;
  value?: number | null;
  isBoolean: boolean;
};

export function HabitDayCell({ status, value, isBoolean }: HabitDayCellProps) {
  if (status === "future" || status === "not-tracked") {
    return (
      <div className="w-[28px] h-[28px] mx-auto" />
    );
  }

  if (status === "completed") {
    return (
      <div className="w-[28px] h-[28px] mx-auto rounded-[4px] bg-[#0d9488] flex items-center justify-center">
        {!isBoolean && value != null ? (
          <span className="text-[9px] font-bold text-white font-mono-display leading-none">
            {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
          </span>
        ) : (
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        )}
      </div>
    );
  }

  if (status === "missed") {
    return (
      <div className="w-[28px] h-[28px] mx-auto rounded-[4px] border border-dashed border-[rgba(13,148,136,0.2)] flex items-center justify-center">
        <X className="w-3 h-3 text-[#93b0b4]" strokeWidth={2} />
      </div>
    );
  }

  // pending (today)
  return (
    <div className="w-[28px] h-[28px] mx-auto rounded-[4px] border border-[rgba(13,148,136,0.25)] flex items-center justify-center relative">
      <span className={cn(
        "w-[6px] h-[6px] rounded-full bg-[#0d9488]",
        "animate-pulse"
      )} />
    </div>
  );
}
