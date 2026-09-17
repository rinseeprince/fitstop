"use client";

import { Fragment } from "react";
import { Dumbbell, GripVertical, Lock, Plus, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { DaySlotDraft } from "./program-builder-types";
import type { SessionDragData, SlotDropData } from "./use-program-dnd";
import { PAST_LOCKED } from "./program-builder-lock-model";
import { roundsRepsShort, setsRepsShort } from "./exercise-summary";
import { isSupersetOrCircuit } from "./program-builder-groups";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";
import { countSessionExercises } from "@/utils/exercise-groups";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";

// One positional day cell. Two states only (empty === rest): a session card
// or a rest marker whose hover swaps to "Add session" (opens the add-session
// popover anchored to the cell). The cell is ALWAYS a droppable (sessions can
// land on rest or swap with an occupied cell; library cards target rest cells
// only via the occupied flag); only the session card is draggable, grip-only
// so plain clicks still open the editor.
type DayCellProps = {
  slot: DaySlotDraft;
  mode: "view" | "edit";
  // The plan editor: a day the coach can't change. The cell renders inert (no
  // drop/drag/clear/add) at reduced opacity, a session with a lock marker; a
  // locked session card stays CLICKABLE — it opens the editor in view mode.
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
  onOpenSession: (sessionUid: string) => void;
  onRequestAddSession: (slot: DaySlotDraft, anchorEl: HTMLElement) => void;
  onClearSlot: (slotUid: string) => void;
};

const SHOWN_EXERCISES = 3;

type ShownLine = { exercise: ExerciseDraft; ordinal: number; roundsAreRows: boolean };

// The session's first exercises, in runs by group: a linked group's run is
// joined by the rail the session editor draws, and an exercise in a superset
// or circuit reads its rounds ("3×8-10", "21-15-9").
function shownRuns(session: SessionDraft): Array<{ key: string; linked: boolean; lines: ShownLine[] }> {
  const runs: Array<{ key: string; linked: boolean; lines: ShownLine[] }> = [];
  let ordinal = 0;
  for (const group of session.groups) {
    if (ordinal >= SHOWN_EXERCISES) break;
    const lines = group.exercises.slice(0, SHOWN_EXERCISES - ordinal).map((exercise, i) => ({
      exercise,
      ordinal: ordinal + i + 1,
      roundsAreRows: isSupersetOrCircuit(group),
    }));
    ordinal += lines.length;
    runs.push({ key: group.uid, linked: group.exercises.length > 1, lines });
  }
  return runs;
}

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
  locked = false,
  greyed = false,
  isToday = false,
  collapsed,
  defaultSurplusPercentage,
  onOpenSession,
  onRequestAddSession,
  onClearSlot,
}: DayCellProps) {
  const editable = mode === "edit" && !locked;
  const session = slot.session;
  // Effective surplus = this day's own value, or the program default it
  // inherits. A custom day (own value) reads in teal; an inherited day reads
  // muted — so the coach can see the program surplus applies everywhere and
  // which days deliberately override it.
  const surplusValue = session
    ? session.calorieSurplusPercentage ?? defaultSurplusPercentage
    : null;
  const surplusIsCustom = session?.calorieSurplusPercentage != null;

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

  const heightClass = collapsed ? "min-h-9" : "min-h-[148px]";

  if (!session) {
    return (
      <div className="h-full">
        <div
          ref={setDropRef}
          className={cn(
            // Quiet by design (mockup `.rest`): no visible border at rest,
            // a dashed teal border only on hover / drag-over.
            "group/rest flex h-full flex-col items-center justify-center rounded-[6px] border border-dashed border-transparent bg-transparent transition-colors",
            heightClass,
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

  return (
    <div className="h-full">
      <div
        ref={(node) => {
          setDropRef(node);
          setDragRef(node);
        }}
        className={cn(
          "group/cell relative flex h-full cursor-pointer flex-col rounded-[6px] bg-white px-[11px] py-2.5 transition-all",
          FOCUS_RING,
          TRAINING_CARD_BORDER,
          heightClass,
          locked && "opacity-60",
          isToday && "ring-1 ring-inset ring-[#0d9488]",
          isOver && "border-[#0d9488]",
          isDragging && "opacity-40",
          !collapsed && !locked &&
            "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
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
            <div className="flex items-center gap-1.5">
              <span className={cn(THUMB_CLASS, "h-5 w-5")}>
                <Dumbbell className="h-3 w-3" strokeWidth={1.5} />
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold", TEXT_PRIMARY)}>
                {session.name}
              </span>
              {locked && (
                <span title={PAST_LOCKED} className={cn("shrink-0", TEXT_MUTED)}>
                  <Lock className="h-3 w-3" strokeWidth={1.5} />
                </span>
              )}
              {surplusValue != null && (
                <span
                  className={cn(
                    MONO_META_CLASS,
                    "shrink-0 text-[10px] font-medium",
                    surplusIsCustom ? "text-[#0d9488]" : TEXT_MUTED,
                  )}
                  title={
                    surplusIsCustom
                      ? "Custom surplus for this day"
                      : "Program default surplus"
                  }
                >
                  +{surplusValue}%
                </span>
              )}
              {editable && (
                <div className="-mr-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover/cell:opacity-100">
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

            {/* Ordered exercise list — name + sets×reps, first 3 + "+N more";
                a linked group's lines sit on the rail the session editor draws. */}
            {countSessionExercises(session) > 0 && (
              <div className="mt-1.5 min-w-0 flex-1 space-y-[3px] overflow-hidden">
                {shownRuns(session).map((run) => {
                  const lines = run.lines.map(({ exercise, ordinal, roundsAreRows }) => (
                    <div key={exercise.uid} className="flex items-baseline gap-1.5">
                      <span className={cn(MONO, "w-2 shrink-0 text-[9.5px] text-[#c2d0cc]")}>
                        {ordinal}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate text-[11px]", TEXT_SECONDARY)}>
                        {exercise.name}
                      </span>
                      <span className={cn(MONO_META_CLASS, "shrink-0 text-[10px]")}>
                        {roundsAreRows ? roundsRepsShort(exercise) : setsRepsShort(exercise)}
                      </span>
                    </div>
                  ));
                  return run.linked ? (
                    <div
                      key={run.key}
                      data-testid="day-cell-group-rail"
                      className="space-y-[3px] border-l-2 border-[rgba(13,148,136,0.15)] pl-1.5"
                    >
                      {lines}
                    </div>
                  ) : (
                    <Fragment key={run.key}>{lines}</Fragment>
                  );
                })}
                {countSessionExercises(session) > SHOWN_EXERCISES && (
                  <div className={cn(MONO_META_CLASS, "pl-[14px] text-[10px] text-[#c2d0cc]")}>
                    +{countSessionExercises(session) - SHOWN_EXERCISES} more
                  </div>
                )}
              </div>
            )}

            {/* Foot: duration (or exercise count) · focus. */}
            <div className="mt-auto flex items-center justify-between gap-1.5 border-t border-[rgba(13,148,136,0.06)] pt-1.5">
              <span className={cn(MONO_META_CLASS, "text-[10px]")}>
                {session.estimatedDurationMinutes != null
                  ? `${session.estimatedDurationMinutes} min`
                  : `${countSessionExercises(session)} ${countSessionExercises(session) === 1 ? "exercise" : "exercises"}`}
              </span>
              {session.focus && (
                <span className={cn("min-w-0 truncate text-[10px]", TEXT_MUTED)}>
                  {session.focus}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
