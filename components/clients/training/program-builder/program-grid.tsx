"use client";

import { Plus } from "lucide-react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { DaySlotDraft, ProgramDraft } from "./program-builder-types";
import { MAX_WEEKS } from "./program-builder-types";
import { GRID_COLS, MONO_LABEL_CLASS, TEXT_SECONDARY } from "./builder-tokens";
import { WeekRow } from "./week-row";

// The weeks × Day 1–7 grid. ONE dual-axis scroll container: the day-header
// row is sticky on vertical scroll (top-0), each row's week-card cell is
// sticky on horizontal scroll (left-0, in week-row), and the corner cell is
// sticky on both (z-40 above both planes). Every row shares GRID_COLS so the
// sticky column and the 7 day columns stay aligned.
type ProgramGridProps = {
  draft: ProgramDraft;
  mode: "view" | "edit";
  collapsedWeeks: Set<string>;
  onToggleCollapse: (weekUid: string) => void;
  onDuplicateWeek: (weekUid: string) => void;
  onDuplicateWeekWithProgression: (weekUid: string) => void;
  onDeleteWeek: (weekUid: string) => void;
  onAddWeek: () => void;
  onOpenSession: (sessionUid: string) => void;
  onRequestAddSession: (slot: DaySlotDraft, anchorEl: HTMLElement) => void;
  onClearSlot: (slotUid: string) => void;
};

export function ProgramGrid({
  draft,
  mode,
  collapsedWeeks,
  onToggleCollapse,
  onDuplicateWeek,
  onDuplicateWeekWithProgression,
  onDeleteWeek,
  onAddWeek,
  onOpenSession,
  onRequestAddSession,
  onClearSlot,
}: ProgramGridProps) {
  const canDelete = draft.weeks.length > 1;

  // Sticky-cell backgrounds must also cover the 8px grid gap to their right,
  // or day cells show a sliver through the gap on horizontal scroll.
  const STICKY_BG =
    "bg-[#f4f7f6] after:absolute after:left-full after:top-0 after:h-full after:w-2 after:bg-[#f4f7f6]";

  return (
    <div className="scrollbar-none relative min-h-0 flex-1 overflow-auto">
      <div className="min-w-[1220px]">
        {/* Day header row — positional Day 1–7, never weekdays. */}
        <div className={cn(GRID_COLS, "sticky top-0 z-30 bg-[#f4f7f6] pb-1.5")}>
          <div className={cn("sticky left-0 z-40", STICKY_BG)} />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={cn("py-1 text-center", MONO_LABEL_CLASS)}>
              Day {i + 1}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <SortableContext
            items={draft.weeks.map((w) => w.uid)}
            strategy={verticalListSortingStrategy}
          >
            {draft.weeks.map((week) => (
              <WeekRow
                key={week.uid}
                week={week}
                mode={mode}
                collapsed={collapsedWeeks.has(week.uid)}
                canDelete={canDelete}
                defaultSurplusPercentage={draft.defaultSurplusPercentage}
                onToggleCollapse={onToggleCollapse}
                onDuplicateWeek={onDuplicateWeek}
                onDuplicateWeekWithProgression={onDuplicateWeekWithProgression}
                onDeleteWeek={onDeleteWeek}
                onOpenSession={onOpenSession}
                onRequestAddSession={onRequestAddSession}
                onClearSlot={onClearSlot}
              />
            ))}
          </SortableContext>
        </div>
      </div>

      {/* Add-week lives OUTSIDE the min-w-[1220px] scroll content and is
          sticky left-0, so it spans the VISIBLE width (its dashed sides stay on
          screen) instead of the 1220px grid width whose edges scroll off. It
          still scrolls vertically with the weeks (no top/bottom offset). */}
      {mode === "edit" && (
        <div className="sticky left-0 pt-2">
          <button
            type="button"
            disabled={draft.weeks.length >= MAX_WEEKS}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.2)] py-2 text-xs transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] disabled:cursor-not-allowed disabled:opacity-50",
              TEXT_SECONDARY,
            )}
            onClick={onAddWeek}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} /> Add week
          </button>
        </div>
      )}

      {/* Bottom breathing room in both modes (mirrors the right column pt-5). */}
      <div className="h-5" />
    </div>
  );
}
