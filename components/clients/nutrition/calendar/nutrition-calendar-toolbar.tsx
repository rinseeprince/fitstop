"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

type NutritionCalendarToolbarProps = {
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  isLoading: boolean;
  editMode: boolean;
  onEditModeChange: (editMode: boolean) => void;
  /** When provided, renders the Regenerate-plan trigger (between edit and delete). */
  onRegenerate?: () => void;
  /** When provided, renders the Delete-plan trigger (always rightmost). */
  onDeletePlan?: () => void;
};

// The calendar's control line IS the divider — same voice as the training
// calendar's toolbar: month nav sits on the left (where a section label would),
// the hairline runs the middle, and the icon actions right-align. Edit mode is
// a pencil/check icon toggle; Regenerate sits between it and Delete-plan,
// which stays rightmost in both modes (destructive-rightmost rail rule).
export function NutritionCalendarToolbar({
  monthLabel,
  onPrevMonth,
  onNextMonth,
  onToday,
  isLoading,
  editMode,
  onEditModeChange,
  onRegenerate,
  onDeletePlan,
}: NutritionCalendarToolbarProps) {
  return (
    // mb-1 + the parent's gap-2 = the divider spec's 12px to the grid below.
    // min-h matches SectionLabel's pinned row height (this row's natural size).
    <div className="mb-1 flex min-h-[24.5px] items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <span
          className={cn(
            MONO_LABEL_CLASS,
            "min-w-[80px] whitespace-nowrap text-center text-[11px]"
          )}
        >
          {monthLabel}
        </span>
        <button
          onClick={onNextMonth}
          aria-label="Next month"
          className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          onClick={onToday}
          className={cn(
            LABEL_CLASS,
            "rounded-[6px] px-2 py-1 text-[11px] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488]"
          )}
        >
          Today
        </button>
        {isLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#93b0b4]" />
        )}
      </div>

      <div className="h-px flex-1 bg-[rgba(13,148,136,0.08)]" />

      <div className="flex items-center gap-2">
        {editMode ? (
          <button
            onClick={() => onEditModeChange(false)}
            aria-label="Done editing"
            title="Done editing"
            className="rounded p-1 text-[#0d9488] transition-colors hover:text-[#0b7f75]"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : (
          <button
            onClick={() => onEditModeChange(true)}
            aria-label="Edit calendar"
            title="Edit calendar"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            aria-label="Regenerate plan"
            title="Regenerate plan"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        {onDeletePlan && (
          <button
            onClick={onDeletePlan}
            aria-label="Delete nutrition plan"
            title="Delete nutrition plan"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
