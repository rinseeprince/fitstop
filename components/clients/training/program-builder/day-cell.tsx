"use client";

import { GripVertical, Plus, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { DaySlotDraft } from "./program-builder-types";
import type { SessionDragData, SlotDropData } from "./use-program-dnd";
import {
  LABEL_CLASS,
  REST_CARD_BORDER,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// One positional day cell. Two states only (empty === rest): a session card
// or a rest marker with an add affordance. The cell is ALWAYS a droppable
// (sessions can land on rest or swap with an occupied cell); only the session
// card is draggable, grip-only so plain clicks still open the editor.
type DayCellProps = {
  slot: DaySlotDraft;
  mode: "view" | "edit";
  collapsed: boolean;
  onOpenSession: (sessionUid: string) => void;
  onAddSession: (slotUid: string) => void;
  onClearSlot: (slotUid: string) => void;
};

// The cell surfaces are divs (they contain buttons, so they can't be buttons
// themselves) — this makes them keyboard-operable like every other affordance.
const pressable = (action: () => void) => ({
  role: "button" as const,
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  },
});

export function DayCell({
  slot,
  mode,
  collapsed,
  onOpenSession,
  onAddSession,
  onClearSlot,
}: DayCellProps) {
  const editable = mode === "edit";
  const session = slot.session;

  const dropData: SlotDropData = { type: "day-slot", slotUid: slot.uid };
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: slot.uid,
    data: dropData,
    disabled: !editable,
  });

  const dragData: SessionDragData = {
    type: "session",
    sessionUid: session?.uid ?? "",
    fromSlotUid: slot.uid,
  };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: session?.uid ?? `${slot.uid}-empty`,
    data: dragData,
    disabled: !editable || !session,
  });

  const heightClass = collapsed ? "min-h-9" : "min-h-[92px]";

  if (!session) {
    return (
      <div className="p-1">
        <div
          ref={setDropRef}
          className={cn(
            "group/rest flex h-full flex-col items-center justify-center rounded-[6px] bg-transparent transition-colors",
            REST_CARD_BORDER,
            heightClass,
            isOver && "border-[#0d9488] bg-[rgba(13,148,136,0.05)]",
            editable && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35",
          )}
          aria-label={editable ? `Add session to day ${slot.orderIndex + 1}` : undefined}
          onClick={editable ? () => onAddSession(slot.uid) : undefined}
          {...(editable ? pressable(() => onAddSession(slot.uid)) : {})}
        >
          {collapsed ? (
            <span className={cn("text-xs", TEXT_MUTED)}>—</span>
          ) : (
            <>
              <span className={LABEL_CLASS}>Rest</span>
              {editable && (
                <span
                  className={cn(
                    "mt-1 flex items-center gap-1 text-[11px] opacity-0 transition-opacity group-hover/rest:opacity-100",
                    TEXT_SECONDARY,
                  )}
                >
                  <Plus className="h-3 w-3" strokeWidth={1.5} /> Add session
                </span>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-1">
      <div
        ref={(node) => {
          setDropRef(node);
          setDragRef(node);
        }}
        className={cn(
          "group/cell relative flex h-full cursor-pointer flex-col rounded-[6px] bg-white p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35",
          TRAINING_CARD_BORDER,
          heightClass,
          isOver && "border-[#0d9488]",
          isDragging && "opacity-40",
          !collapsed && "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
        )}
        aria-label={`Open session ${session.name}`}
        onClick={() => onOpenSession(session.uid)}
        {...pressable(() => onOpenSession(session.uid))}
      >
        {collapsed ? (
          <span className={cn("truncate text-xs font-medium", TEXT_PRIMARY)}>
            {session.name}
          </span>
        ) : (
          <>
            <div className="flex items-start justify-between gap-1">
              <span className={cn("line-clamp-2 text-xs font-semibold", TEXT_PRIMARY)}>
                {session.name}
              </span>
              {editable && (
                <div className="-mr-1 -mt-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover/cell:opacity-100">
                  <button
                    type="button"
                    aria-label="Clear session (back to rest)"
                    className={cn("rounded p-1 hover:bg-[rgba(13,148,136,0.08)]", TEXT_MUTED)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearSlot(slot.uid);
                    }}
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    aria-label="Drag session"
                    className={cn("cursor-grab rounded p-1 hover:bg-[rgba(13,148,136,0.08)] active:cursor-grabbing", TEXT_MUTED)}
                    onClick={(e) => e.stopPropagation()}
                    {...attributes}
                    {...listeners}
                  >
                    <GripVertical className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
              )}
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-2">
              <span className="rounded-[3px] bg-[rgba(13,148,136,0.08)] px-1 py-px text-[9px] font-semibold uppercase tracking-[0.06em] text-[#0d9488]">
                Train
              </span>
              <span className={cn("text-[10px]", TEXT_SECONDARY)}>
                {session.exercises.length}{" "}
                {session.exercises.length === 1 ? "exercise" : "exercises"}
              </span>
              {session.calorieSurplusPercentage != null && (
                <span className="ml-auto font-mono text-[10px] text-[#0d9488]">
                  +{session.calorieSurplusPercentage}%
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
