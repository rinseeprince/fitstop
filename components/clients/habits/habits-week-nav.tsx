"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type HabitsWeekNavProps = {
  weekOffset: number;
  onPrev: () => void;
  onNext: () => void;
  weekStart: string;
  weekEnd: string;
};

function formatShortDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export function HabitsWeekNav({
  weekOffset,
  onPrev,
  onNext,
  weekStart,
  weekEnd,
}: HabitsWeekNavProps) {
  const isCurrentWeek = weekOffset === 0;
  const label = isCurrentWeek ? "This Week" : "Previous Week";

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPrev}
        className="w-[28px] h-[28px] rounded-[6px] border border-[rgba(13,148,136,0.08)] flex items-center justify-center text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
      </button>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-[#0c1a1e]">{label}</span>
        <span className="text-[12px] font-mono-display text-[#93b0b4]">
          {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
        </span>
      </div>
      <button
        onClick={onNext}
        disabled={isCurrentWeek}
        className="w-[28px] h-[28px] rounded-[6px] border border-[rgba(13,148,136,0.08)] flex items-center justify-center text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
