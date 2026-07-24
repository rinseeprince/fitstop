"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

type HabitsWeekNavProps = {
  weekOffset: number;
  onPrev: () => void;
  onNext: () => void;
  weekStart: string;
  weekEnd: string;
  actions?: ReactNode;
};

function formatShortDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// The habits control line IS the divider (calendar-toolbar idiom): the week
// nav sits on the left where a section label would, the hairline runs the
// middle, and row actions right-align. Block-flow parent → the row owns the
// divider spec's full mb-3.
export function HabitsWeekNav({
  weekOffset,
  onPrev,
  onNext,
  weekStart,
  weekEnd,
  actions,
}: HabitsWeekNavProps) {
  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="mb-3 flex min-h-[24.5px] items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          aria-label="Previous week"
          className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        {/* min-w must exceed the range's widest state (~113px with both days
            double-digit, CDP-derived) so the next chevron and hairline don't
            shift as weeks page (the calendar's min-w-[80px] idiom). */}
        <span
          className={cn(
            MONO_LABEL_CLASS,
            "min-w-[116px] whitespace-nowrap text-center text-[11px]"
          )}
        >
          {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
        </span>
        <button
          onClick={onNext}
          disabled={isCurrentWeek}
          aria-label="Next week"
          className={cn(
            "rounded p-1 transition-colors",
            isCurrentWeek
              ? "cursor-default text-[#d5e0dd]"
              : "text-[#93b0b4] hover:text-[#0d9488]"
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="h-px flex-1 bg-[rgba(13,148,136,0.08)]" />

      {actions}
    </div>
  );
}
