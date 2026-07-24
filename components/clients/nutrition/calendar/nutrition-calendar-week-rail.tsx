"use client";

import { memo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, RotateCcw } from "lucide-react";

export type NutritionWeekAction = "edit_week" | "reset_week";

type NutritionCalendarWeekRailProps = {
  /** Monday of this row (YYYY-MM-DD) — names the row for screen readers. */
  weekStartDate: string;
  /** Whether week actions render. False outside edit mode or when the week has no editable days. */
  showKebab: boolean;
  isSaving: boolean;
  onAction: (action: NutritionWeekAction) => void;
};

function formatWeekOf(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Always-rendered 42px rail matching the training calendar's, so the two
// calendars' day columns align pixel-for-pixel across tabs. Nutrition has one
// event per day, so a per-week count chip would be constant noise — outside
// edit mode the rail is deliberately empty. The kebab is edit-mode-only and
// hover-revealed (stays visible while its menu is open). Both actions act on
// the week's ELIGIBLE days only (today-forward + scheduled), the same gate as
// cell selection.
export const NutritionCalendarWeekRail = memo(function NutritionCalendarWeekRail({
  weekStartDate,
  showKebab,
  isSaving,
  onAction,
}: NutritionCalendarWeekRailProps) {
  return (
    <div className="group/wk flex flex-col items-center gap-1 pt-2.5">
      {showKebab && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Actions for week of ${formatWeekOf(weekStartDate)}`}
              className="rounded p-0.5 text-[#93b0b4] opacity-0 transition-opacity hover:bg-[rgba(13,148,136,0.08)] group-hover/wk:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem disabled={isSaving} onClick={() => onAction("edit_week")}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              Edit this week
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isSaving} onClick={() => onAction("reset_week")}>
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
              Reset this week
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
