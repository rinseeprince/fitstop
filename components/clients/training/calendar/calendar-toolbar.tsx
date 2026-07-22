"use client";

import { BookOpen, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { SectionLabel } from "@/components/programs/shared/section-label";

type CalendarToolbarProps = {
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  isLoading: boolean;
  editMode: boolean;
  /** When provided, renders the View/Edit segmented control. */
  onEditModeChange?: (editMode: boolean) => void;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  /** Sessions in the viewed month — the divider's mono meta. */
  monthSessionCount: number;
  /** When provided, renders the Delete-future trigger. */
  onDeleteFuture?: () => void;
};

// The Schedule divider IS the toolbar: one SectionLabel row carrying the
// month nav, Today chip and (edit-mode) the Library/View-Edit/Delete-future
// controls in its actions slot — no separate control row above the grid.
export function CalendarToolbar({
  monthLabel,
  onPrevMonth,
  onNextMonth,
  onToday,
  isLoading,
  editMode,
  onEditModeChange,
  libraryOpen,
  onToggleLibrary,
  monthSessionCount,
  onDeleteFuture,
}: CalendarToolbarProps) {
  return (
    <SectionLabel
      label="Schedule"
      meta={`${monthSessionCount} session${monthSessionCount === 1 ? "" : "s"}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onPrevMonth}
            aria-label="Previous month"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <span className="min-w-[92px] text-center font-mono-display text-[12px] font-semibold text-[#0c1a1e]">
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
            className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-[#5a7d82] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0c1a1e]"
          >
            Today
          </button>
          {isLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#93b0b4]" />
          )}

          {editMode && (
            <button
              onClick={onToggleLibrary}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] transition-colors",
                libraryOpen
                  ? "bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
                  : "border border-[rgba(13,148,136,0.08)] bg-white font-medium text-[#5a7d82] hover:text-[#0c1a1e]"
              )}
            >
              <BookOpen className="h-3 w-3" strokeWidth={1.5} />
              Library
            </button>
          )}
          {onEditModeChange && (
            <SegmentedControl
              options={[
                { value: "view", label: "View" },
                { value: "edit", label: "Edit" },
              ]}
              value={editMode ? "edit" : "view"}
              onChange={(value) => onEditModeChange(value === "edit")}
            />
          )}
          {onDeleteFuture && (
            <button
              onClick={onDeleteFuture}
              aria-label="Delete future sessions"
              title="Delete future sessions"
              className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060]"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      }
    />
  );
}
