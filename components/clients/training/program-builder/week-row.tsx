"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { DaySlotDraft, WeekDraft } from "./program-builder-types";
import type { WeekDragData } from "./use-program-dnd";
import { GRID_COLS } from "./builder-tokens";
import { WeekCard } from "./week-card";
import { DayCell } from "./day-cell";

// One grid row = sticky week card + 7 day cells. The row is the sortable node
// (vertical week reorder); the grip that activates it lives in WeekCard.
// Collapsed rows keep the SAME column template so columns stay aligned.
type WeekRowProps = {
  week: WeekDraft;
  mode: "view" | "edit";
  collapsed: boolean;
  canDelete: boolean;
  onToggleCollapse: (weekUid: string) => void;
  onDuplicateWeek: (weekUid: string) => void;
  onDeleteWeek: (weekUid: string) => void;
  onOpenSession: (sessionUid: string) => void;
  onRequestAddSession: (slot: DaySlotDraft, anchorEl: HTMLElement) => void;
  onClearSlot: (slotUid: string) => void;
};

export function WeekRow({
  week,
  mode,
  collapsed,
  canDelete,
  onToggleCollapse,
  onDuplicateWeek,
  onDeleteWeek,
  onOpenSession,
  onRequestAddSession,
  onClearSlot,
}: WeekRowProps) {
  const dragData: WeekDragData = { type: "week", weekUid: week.uid };
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: week.uid,
    data: dragData,
    disabled: mode !== "edit",
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(GRID_COLS, isDragging && "opacity-40")}
    >
      {/* Opaque sticky plane so day cells pass UNDER the week card on
          horizontal scroll. z-20 sits below the sticky header (z-30). */}
      <div className="sticky left-0 z-20 bg-[#f4f7f6] p-1">
        <WeekCard
          week={week}
          mode={mode}
          collapsed={collapsed}
          canDelete={canDelete}
          onToggleCollapse={() => onToggleCollapse(week.uid)}
          onDuplicate={() => onDuplicateWeek(week.uid)}
          onDelete={() => onDeleteWeek(week.uid)}
          dragHandleProps={{ ...attributes, ...listeners }}
        />
      </div>
      {week.days.map((slot) => (
        <DayCell
          key={slot.uid}
          slot={slot}
          mode={mode}
          collapsed={collapsed}
          onOpenSession={onOpenSession}
          onRequestAddSession={onRequestAddSession}
          onClearSlot={onClearSlot}
        />
      ))}
    </div>
  );
}
