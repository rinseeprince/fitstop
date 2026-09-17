"use client";

import { Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { DaySlotDraft } from "./program-builder-types";
import type { DayReorder, SlotDropData } from "./use-program-dnd";
import { dayHasRoom } from "./program-builder-model";
import type { DropLineEdge } from "./drop-line";
import { FOCUS_RING, LABEL_CLASS, TEXT_MUTED } from "./builder-tokens";
import { DaySessionCard, pressable } from "./day-session-card";

// One positional day cell. Two states only (empty === rest): the day's session
// cards, one per session in the day's order, or a rest marker whose hover
// swaps to "Add session" (opens the add-session popover anchored to the cell).
// A day holding sessions offers "Add session" on each card, and the session
// added joins the day, last. The cell is ALWAYS the droppable (use-program-dnd
// judges a drop by how many sessions the day holds): a session from another
// day joins it, last, and every card of the day shows the teal border; a
// session dragged over its own day shows, as a line between the cards, the
// place it would take instead.
type DayCellProps = {
  slot: DaySlotDraft;
  mode: "view" | "edit";
  // The plan editor: a day the coach can't change. The cell renders inert (no
  // drop/drag/remove/add) at reduced opacity, each session with a lock marker;
  // a locked session card stays CLICKABLE — it opens the editor in view mode.
  locked?: boolean;
  // A day past the plan's limit: greyed and empty — it can't hold a session.
  greyed?: boolean;
  // The client's today, ringed so the coach knows where the client is. The
  // ring is drawn INSIDE the box: Day 1's left edge sits under the sticky week
  // column's opaque strip, which hides anything drawn outside it.
  isToday?: boolean;
  collapsed: boolean;
  // Program-level default surplus — the value a session inherits when it has no
  // per-day override. Drives the effective-surplus badge.
  defaultSurplusPercentage: number | null;
  // Set for the whole drag of one of this day's sessions: where it would land
  // in the day (use-program-dnd). A session never joins its own day.
  reorder?: DayReorder | null;
  onOpenSession: (sessionUid: string) => void;
  onRequestAddSession: (slot: DaySlotDraft, anchorEl: HTMLElement) => void;
  onRemoveSession: (sessionUid: string) => void;
};

// The line for a card: before the card at the place, or after the last card
// when the place is past it. The first card draws its top line inside its own
// edge, where the row above would otherwise hide it.
function dropLineFor(place: number | null, index: number, count: number): DropLineEdge | null {
  if (place == null) return null;
  if (place === index) return index === 0 ? "first-item-top" : "item-top";
  return place === count && index === count - 1 ? "item-bottom" : null;
}

export function DayCell({
  slot,
  mode,
  locked = false,
  greyed = false,
  isToday = false,
  collapsed,
  defaultSurplusPercentage,
  reorder = null,
  onOpenSession,
  onRequestAddSession,
  onRemoveSession,
}: DayCellProps) {
  const editable = mode === "edit" && !locked;

  const dropData: SlotDropData = {
    type: "day-slot",
    slotUid: slot.uid,
    sessionCount: slot.sessions.length,
  };
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: slot.uid,
    data: dropData,
    disabled: !editable,
  });

  if (slot.sessions.length === 0) {
    return (
      <div className="h-full">
        <div
          ref={setDropRef}
          className={cn(
            // Quiet by design (mockup `.rest`): no visible border at rest,
            // a dashed teal border only on hover / drag-over.
            "group/rest flex h-full flex-col items-center justify-center rounded-[6px] border border-dashed border-transparent bg-transparent transition-colors",
            collapsed ? "min-h-9" : "min-h-[148px]",
            locked && "opacity-60",
            greyed && "bg-[rgba(147,176,180,0.12)]",
            isToday && "ring-1 ring-inset ring-[#0d9488]",
            isOver && "border-[#0d9488] bg-[rgba(13,148,136,0.05)]",
            editable && cn("cursor-pointer hover:border-[rgba(13,148,136,0.25)] hover:bg-[rgba(13,148,136,0.03)]", FOCUS_RING),
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
          {greyed ? null : collapsed ? (
            <span className={cn("text-xs", TEXT_MUTED)}>—</span>
          ) : (
            <>
              {/* Hover swaps the rest label for the add affordance (mockup). */}
              <span className={cn(LABEL_CLASS, editable && "group-hover/rest:hidden")}>
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

  // The stack fills the cell; each card grows with it, so a day's cards reach
  // the row's bottom edge as a single card always has.
  const place = reorder?.place ?? null;
  return (
    <div ref={setDropRef} data-day-stack="" className="flex h-full flex-col gap-2">
      {slot.sessions.map((session, index) => (
        <DaySessionCard
          key={session.uid}
          session={session}
          slotUid={slot.uid}
          index={index}
          editable={editable}
          canAddSession={editable && dayHasRoom(slot)}
          locked={locked}
          isToday={isToday}
          // A session dragged from this day changes its place here, which the
          // line shows; only a drag from elsewhere joins, and lights the cards.
          isOver={isOver && reorder == null}
          dropLine={dropLineFor(place, index, slot.sessions.length)}
          collapsed={collapsed}
          defaultSurplusPercentage={defaultSurplusPercentage}
          onOpenSession={onOpenSession}
          onRemoveSession={onRemoveSession}
          onAddSession={(anchor) => onRequestAddSession(slot, anchor)}
        />
      ))}
    </div>
  );
}
