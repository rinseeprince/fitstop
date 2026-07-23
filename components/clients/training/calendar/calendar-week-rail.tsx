"use client";

import { memo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Copy, CopyPlus, MoreVertical, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

export type WeekAction =
  | "duplicate_next"
  | "duplicate_remaining"
  | "save_to_library"
  | "clear";

type CalendarWeekRailProps = {
  /** 1-based week number within the displayed month grid. */
  weekNumber: number;
  /** Events in this week row (any status). */
  sessionCount: number;
  editMode: boolean;
  /** Whether week-level actions render. False when no plan or the row spans plans. */
  showKebab: boolean;
  disabledReason?: string;
  isLastWeek: boolean;
  onAction: (action: WeekAction) => void;
};

// Always-rendered 42px rail (builder week-card language): W# chip + session
// count, so entering edit mode no longer shifts every column. The kebab is
// edit-mode-only and hover-revealed (stays visible while its menu is open).
export const CalendarWeekRail = memo(function CalendarWeekRail({
  weekNumber,
  sessionCount,
  editMode,
  showKebab,
  disabledReason,
  isLastWeek,
  onAction,
}: CalendarWeekRailProps) {
  return (
    <div className="group/wk flex flex-col items-center gap-1 pt-2.5">
      <span
        className={cn(
          MONO_LABEL_CLASS,
          "normal-case tracking-normal rounded-[6px] bg-[rgba(13,148,136,0.08)] px-[7px] py-1 text-[10.5px] font-semibold text-[#0a5c55]"
        )}
      >
        W{weekNumber}
      </span>
      <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal text-[9.5px] text-[#c2d0cc]")}>
        {sessionCount > 0 ? `${sessionCount}×` : ""}
      </span>

      {editMode &&
        (showKebab ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Week ${weekNumber} actions`}
                className="rounded p-0.5 text-[#93b0b4] opacity-0 transition-opacity hover:bg-[rgba(13,148,136,0.08)] group-hover/wk:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreVertical className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {!isLastWeek && (
                <DropdownMenuItem onClick={() => onAction("duplicate_next")}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Duplicate to next week
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onAction("duplicate_remaining")}>
                <CopyPlus className="mr-2 h-3.5 w-3.5" />
                Duplicate to all remaining
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("save_to_library")}>
                <Save className="mr-2 h-3.5 w-3.5" />
                Save as plan
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[#c06060] focus:text-[#c06060]"
                onClick={() => onAction("clear")}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Clear week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : disabledReason ? (
          <span
            className={cn(MONO, "cursor-help text-[10px] text-[#93b0b4]")}
            title={disabledReason}
          >
            —
          </span>
        ) : null)}
    </div>
  );
});
