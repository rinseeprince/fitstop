"use client";

import { GripVertical, Plus, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { DaySlotDraft } from "./program-builder-types";
import type { SessionDragData, SlotDropData } from "./use-program-dnd";
import {
  CHIP_NEUTRAL_CLASS,
  MONO_LABEL_CLASS,
  REST_CARD_BORDER,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// One positional day cell. Two states only (empty === rest): a session card
// or a rest marker whose hover swaps to "Add session" (opens the add-session
// popover anchored to the cell). The cell is ALWAYS a droppable (sessions can
// land on rest or swap with an occupied cell; library cards target rest cells
// only via the occupied flag); only the session card is draggable, grip-only
// so plain clicks still open the editor.
type DayCellProps = {
  slot: DaySlotDraft;
  mode: "view" | "edit";
  collapsed: boolean;
  onOpenSession: (sessionUid: string) => void;
  onRequestAddSession: (slot: DaySlotDraft, anchorEl: HTMLElement) => void;
  onClearSlot: (slotUid: string) => void;
};

// The cell surfaces are divs (they contain buttons, so they can't be buttons
// themselves) — this makes them keyboard-operable like every other affordance.
const pressable = (action: (target: HTMLElement) => void) => ({
  role: "button" as const,
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent) => {
    // Bubbled keydowns from descendant buttons (grip, clear-X) must not
    // activate the card — they have their own native Enter/Space handling.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action(e.currentTarget as HTMLElement);
    }
  },
});

export function DayCell({
  slot,
  mode,
  collapsed,
  onOpenSession,
  onRequestAddSession,
  onClearSlot,
}: DayCellProps) {
  const editable = mode === "edit";
  const session = slot.session;

  const dropData: SlotDropData = {
    type: "day-slot",
    slotUid: slot.uid,
    occupied: session != null,
  };
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
            editable && "cursor-pointer hover:border-[rgba(13,148,136,0.25)] hover:bg-[rgba(13,148,136,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/35",
          )}
          aria-label={editable ? `Add session to day ${slot.orderIndex + 1}` : undefined}
          onClick={
            editable
              ? (e) => onRequestAddSession(slot, e.currentTarget)
              : undefined
          }
          {...(editable
            ? pressable((target) => onRequestAddSession(slot, target))
            : {})}
        >
          {collapsed ? (
            <span className={cn("text-xs", TEXT_MUTED)}>—</span>
          ) : (
            <>
              {/* Hover swaps the rest label for the add affordance (mockup). */}
              <span className={cn(MONO_LABEL_CLASS, editable && "group-hover/rest:hidden")}>
                Rest
              </span>
              {editable && (
                <span className="hidden items-center gap-1 text-[11px] font-semibold text-[#0d9488] group-hover/rest:flex">
                  <Plus className="h-3 w-3" strokeWidth={2} /> Add session
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
              <span className={cn("line-clamp-2 pr-1 text-xs font-semibold", TEXT_PRIMARY)}>
                {session.name}
              </span>
              {editable && (
                <div className="-mr-1 -mt-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover/cell:opacity-100">
                  <button
                    type="button"
                    aria-label="Clear session (back to rest)"
                    className={cn("rounded p-1 hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]", TEXT_MUTED)}
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
              {session.focus && (
                <span className={cn("max-w-[80px] truncate", CHIP_NEUTRAL_CLASS)}>
                  {session.focus}
                </span>
              )}
              <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                {session.exercises.length}{" "}
                {session.exercises.length === 1 ? "exercise" : "exercises"}
                {session.estimatedDurationMinutes != null &&
                  ` · ${session.estimatedDurationMinutes}m`}
              </span>
              {session.calorieSurplusPercentage != null && (
                <span className="ml-auto font-mono-display text-[10px] text-[#0d9488]">
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
