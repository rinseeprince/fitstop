"use client";

import { Plus } from "lucide-react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { ProgramDraft } from "./program-builder-types";
import { MAX_WEEKS } from "./program-builder-types";
import { GRID_COLS, LABEL_CLASS, TEXT_SECONDARY } from "./builder-tokens";
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
  onDeleteWeek: (weekUid: string) => void;
  onAddWeek: () => void;
  onOpenSession: (sessionUid: string) => void;
  onAddSession: (slotUid: string) => void;
  onClearSlot: (slotUid: string) => void;
};

export function ProgramGrid({
  draft,
  mode,
  collapsedWeeks,
  onToggleCollapse,
  onDuplicateWeek,
  onDeleteWeek,
  onAddWeek,
  onOpenSession,
  onAddSession,
  onClearSlot,
}: ProgramGridProps) {
  const canDelete = draft.weeks.length > 1;

  return (
    <div className="relative max-h-[calc(100vh-16rem)] overflow-auto rounded-[6px]">
      <div className="min-w-max">
        {/* Day header row — positional Day 1–7, never weekdays. */}
        <div className={cn(GRID_COLS, "sticky top-0 z-30 bg-[#f4f7f6]")}>
          <div className="sticky left-0 z-40 bg-[#f4f7f6] p-1" />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="p-1">
              <div className={cn("px-2 py-1.5", LABEL_CLASS)}>Day {i + 1}</div>
            </div>
          ))}
        </div>

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
              onToggleCollapse={onToggleCollapse}
              onDuplicateWeek={onDuplicateWeek}
              onDeleteWeek={onDeleteWeek}
              onOpenSession={onOpenSession}
              onAddSession={onAddSession}
              onClearSlot={onClearSlot}
            />
          ))}
        </SortableContext>

        {mode === "edit" && (
          <div className={GRID_COLS}>
            <div className="sticky left-0 z-20 bg-[#f4f7f6] p-1">
              <button
                type="button"
                disabled={draft.weeks.length >= MAX_WEEKS}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.2)] px-3 py-2 text-xs transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] disabled:cursor-not-allowed disabled:opacity-50",
                  TEXT_SECONDARY,
                )}
                onClick={onAddWeek}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} /> Add week
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
