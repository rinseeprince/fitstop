"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { TextSkeleton } from "@/components/text-skeleton";
import { MONO_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

type HabitsWeekNavProps = {
  /** The week shown, first and last day; null while the client's week is not known yet. */
  weekStart: string | null;
  weekEnd: string | null;
  canPrev: boolean;
  /** True once the week is known: the tracker pages forward past today too, to plan one-date changes. */
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  actions?: ReactNode;
};

// The habits control line IS the divider (calendar-toolbar idiom): the week
// nav sits on the left where a section label would, the hairline runs the
// middle, and row actions right-align. Block-flow parent → the row owns the
// divider spec's full mb-3.
export function HabitsWeekNav({
  weekStart,
  weekEnd,
  canPrev,
  canNext,
  onPrev,
  onNext,
  actions,
}: HabitsWeekNavProps) {
  return (
    <div className="mb-3 flex min-h-[24.5px] items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Previous week"
          className={cn(
            "rounded p-1 transition-colors",
            canPrev ? "text-[#93b0b4] hover:text-[#0d9488]" : "cursor-default text-[#d5e0dd]"
          )}
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
          {weekStart && weekEnd ? (
            `${formatDateOnlyShort(weekStart)} – ${formatDateOnlyShort(weekEnd)}`
          ) : (
            <TextSkeleton className="w-24" />
          )}
        </span>
        <button
          onClick={onNext}
          disabled={!canNext}
          aria-label="Next week"
          className={cn(
            "rounded p-1 transition-colors",
            canNext ? "text-[#93b0b4] hover:text-[#0d9488]" : "cursor-default text-[#d5e0dd]"
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
