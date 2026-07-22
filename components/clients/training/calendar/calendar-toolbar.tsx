"use client";

import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type CalendarToolbarProps = {
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  isLoading: boolean;
  editMode: boolean;
  /** When provided, renders the edit-mode icon toggle. */
  onEditModeChange?: (editMode: boolean) => void;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  /** Sessions in the viewed month. */
  monthSessionCount: number;
  /** When provided, renders the Delete-future trigger (always rightmost). */
  onDeleteFuture?: () => void;
};

// The calendar's control line IS the divider: the month nav sits on the left
// (where a section label would), the hairline runs the middle, and the meta +
// icon actions right-align — all in the divider's quiet mono voice. Edit mode
// is a pencil/check icon toggle; Delete-future stays rightmost in both modes.
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
    <div className="mb-3 flex items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <span className="min-w-[80px] whitespace-nowrap text-center font-mono-display text-[11px] text-[#93b0b4]">
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
      </div>

      <div className="h-px flex-1 bg-[rgba(13,148,136,0.08)]" />

      <span className="whitespace-nowrap font-mono-display text-[11px] text-[#93b0b4]">
        {monthSessionCount} session{monthSessionCount === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        {editMode && (
          <button
            onClick={onToggleLibrary}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] transition-colors",
              libraryOpen
                ? "bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
                : "border border-[rgba(13,148,136,0.08)] bg-white font-medium text-[#5a7d82] hover:text-[#0c1a1e]"
            )}
          >
            <BookOpen className="h-3 w-3" strokeWidth={1.5} />
            Library
          </button>
        )}
        {onEditModeChange &&
          (editMode ? (
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
          ))}
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
    </div>
  );
}
