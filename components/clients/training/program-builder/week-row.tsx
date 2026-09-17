"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { DaySlotDraft, WeekDraft } from "./program-builder-types";
import type { WeekDragData } from "./use-program-dnd";
import type { PlanDayRules } from "./program-builder-lock-model";
import { GRID_COLS } from "./builder-tokens";
import { WeekCard } from "./week-card";
import { DayCell } from "./day-cell";

// One grid row = sticky week card + 7 day cells. The row is the sortable node
// (vertical week reorder); the grip that activates it lives in WeekCard.
// Collapsed rows keep the SAME column template so columns stay aligned.
// With the plan editor's day rules the row takes its week actions from the
// lock model: a week touching a locked or greyed day can't be dragged, a week
// touching history can't be deleted, and a copy lands only after the last week
// of history, on a week the plan can reach, pushing no session onto a greyed
// day.
type WeekRowProps = {
  week: WeekDraft;
  mode: "view" | "edit";
  dayRules?: PlanDayRules;
  collapsed: boolean;
  canDelete: boolean;
  defaultSurplusPercentage: number | null;
  onToggleCollapse: (weekUid: string) => void;
  onDuplicateWeek: (weekUid: string) => void;
  onDuplicateWeekWithProgression: (weekUid: string) => void;
  onDeleteWeek: (weekUid: string) => void;
  onOpenSession: (sessionUid: string) => void;
  onRequestAddSession: (slot: DaySlotDraft, anchorEl: HTMLElement) => void;
  onRemoveSession: (sessionUid: string) => void;
};

export function WeekRow({
  week,
  mode,
  dayRules,
  collapsed,
  canDelete,
  defaultSurplusPercentage,
  onToggleCollapse,
  onDuplicateWeek,
  onDuplicateWeekWithProgression,
  onDeleteWeek,
  onOpenSession,
  onRequestAddSession,
  onRemoveSession,
}: WeekRowProps) {
  const weekRules = dayRules?.weeks.get(week.uid);
  const weekLocked = weekRules != null && !weekRules.canReorder;
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
    disabled: mode !== "edit" || weekLocked,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(GRID_COLS, isDragging && "opacity-40")}
    >
      {/* Opaque sticky plane so day cells pass UNDER the week chip on
          horizontal scroll. z-20 sits below the sticky header (z-30); the
          after: strip covers the 8px grid gap to the right. */}
      <div className="sticky left-0 z-20 bg-[#f4f7f6] after:absolute after:left-full after:top-0 after:h-full after:w-2 after:bg-[#f4f7f6]">
        <WeekCard
          week={week}
          mode={mode}
          collapsed={collapsed}
          canDelete={canDelete && (weekRules?.canDelete ?? true)}
          canDuplicate={weekRules?.canDuplicate ?? true}
          canReorder={!weekLocked}
          onToggleCollapse={() => onToggleCollapse(week.uid)}
          onDuplicate={() => onDuplicateWeek(week.uid)}
          onDuplicateWithProgression={() => onDuplicateWeekWithProgression(week.uid)}
          onDelete={() => onDeleteWeek(week.uid)}
          dragHandleProps={{ ...attributes, ...listeners }}
        />
      </div>
      {week.days.map((slot) => (
        <DayCell
          key={slot.uid}
          slot={slot}
          mode={mode}
          locked={dayRules?.locked.has(slot.uid) ?? false}
          greyed={dayRules?.beyond.has(slot.uid) ?? false}
          isToday={dayRules?.todaySlotUid === slot.uid}
          collapsed={collapsed}
          defaultSurplusPercentage={defaultSurplusPercentage}
          onOpenSession={onOpenSession}
          onRequestAddSession={onRequestAddSession}
          onRemoveSession={onRemoveSession}
        />
      ))}
    </div>
  );
}
