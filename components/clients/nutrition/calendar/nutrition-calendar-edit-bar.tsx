"use client";

import { Button } from "@/components/ui/button";
import { Pencil, RotateCcw } from "lucide-react";

type NutritionCalendarEditBarProps = {
  /** Whether "This week" can resolve (today's week is in the current view). */
  todayWeekAvailable: boolean;
  selectedCount: number;
  isSaving: boolean;
  onSelectThisWeek: () => void;
  onSelectThisMonth: () => void;
  onEdit: () => void;
  onReset: () => void;
  onClear: () => void;
};

/** Bulk affordances + selection actions for the nutrition calendar edit mode (◆2). */
export function NutritionCalendarEditBar({
  todayWeekAvailable,
  selectedCount,
  isSaving,
  onSelectThisWeek,
  onSelectThisMonth,
  onEdit,
  onReset,
  onClear,
}: NutritionCalendarEditBarProps) {
  return (
    <div className="flex items-center gap-2 px-1 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[11px]"
        disabled={!todayWeekAvailable}
        onClick={onSelectThisWeek}
      >
        This week
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onSelectThisMonth}>
        This month
      </Button>
      {selectedCount > 0 && (
        <>
          <span className="text-[11px] text-[#5a7d82] ml-1">{selectedCount} selected</span>
          <Button size="sm" className="h-7 text-[11px]" disabled={isSaving} onClick={onEdit}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={isSaving}
            onClick={onReset}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
          <button
            onClick={onClear}
            className="text-[11px] text-[#93b0b4] hover:text-[#0c1a1e] px-1"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
