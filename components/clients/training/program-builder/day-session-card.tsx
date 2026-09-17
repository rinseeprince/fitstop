"use client";

import { Fragment, useCallback } from "react";
import { Dumbbell, GripVertical, Lock, Plus, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { ExerciseDraft, SessionDraft } from "./program-builder-types";
import {
  daySessionDropId,
  type DaySessionDropData,
  type SessionDragData,
} from "./use-program-dnd";
import { DropLine, type DropLineEdge } from "./drop-line";
import { PAST_LOCKED } from "./program-builder-lock-model";
import { roundsRepsShort, setsRepsShort } from "./exercise-summary";
import { isSupersetOrCircuit } from "./program-builder-groups";
import {
  FOCUS_RING,
  MONO,
  MONO_META_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";
import { countSessionExercises } from "@/utils/exercise-groups";

// One session's card in a day cell. A day holding several sessions stacks one
// card per session; each card drags its own session (grip-only, so plain
// clicks still open the editor) and opens its own session on click, while the
// day cell around the stack is the drop target. The card is also where a
// session dragged within its own day finds its place (a "day-session"
// droppable), and draws the line that shows it.
type DaySessionCardProps = {
  session: SessionDraft;
  slotUid: string;
  // The session's place in its day, 0 first.
  index: number;
  // Edit mode on a day the coach can change: the card drags and removes.
  editable: boolean;
  // Whether the card offers "Add session" — an editable day with room.
  canAddSession: boolean;
  // The plan editor: a day the coach can't change. The card renders at reduced
  // opacity with a lock marker, and STAYS clickable — it opens the editor in
  // view mode.
  locked: boolean;
  isToday: boolean;
  // A drag that would join this card's day hovers it.
  isOver: boolean;
  // Where a session dragged within this day would land, drawn on this card.
  dropLine: DropLineEdge | null;
  collapsed: boolean;
  defaultSurplusPercentage: number | null;
  onOpenSession: (sessionUid: string) => void;
  onRemoveSession: (sessionUid: string) => void;
  // Opens the add-session popover for the card's day, level with `control`.
  onAddSession: (control: HTMLElement) => void;
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
export const pressable = (action: (target: HTMLElement) => void) => ({
  role: "button" as const,
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent) => {
    // Bubbled keydowns from descendant buttons (grip, remove-X) must not
    // activate the card — they have their own native Enter/Space handling.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action(e.currentTarget as HTMLElement);
    }
  },
});

export function DaySessionCard({
  session,
  slotUid,
  index,
  editable,
  canAddSession,
  locked,
  isToday,
  isOver,
  dropLine,
  collapsed,
  defaultSurplusPercentage,
  onOpenSession,
  onRemoveSession,
  onAddSession,
}: DaySessionCardProps) {
  // Effective surplus = this day's own value, or the program default it
  // inherits. A custom day (own value) reads in teal; an inherited day reads
  // muted — so the coach can see the program surplus applies everywhere and
  // which days deliberately override it.
  const surplusValue = session.calorieSurplusPercentage ?? defaultSurplusPercentage;
  const surplusIsCustom = session.calorieSurplusPercentage != null;
  const exerciseCount = countSessionExercises(session);

  const dragData: SessionDragData = {
    type: "session",
    sessionUid: session.uid,
    fromSlotUid: slotUid,
    index,
  };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: session.uid,
    data: dragData,
    disabled: !editable,
  });
  const dropData: DaySessionDropData = { type: "day-session", slotUid, index };
  const { setNodeRef: setDropRef } = useDroppable({
    id: daySessionDropId(session.uid),
    data: dropData,
    disabled: !editable,
  });
  // Both refs are stable, so the card's node is handed over once, not on every render.
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/cell relative flex flex-auto cursor-pointer flex-col rounded-[6px] bg-white px-[11px] py-2.5 transition-all",
        FOCUS_RING,
        TRAINING_CARD_BORDER,
        collapsed ? "min-h-9" : "min-h-[148px]",
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
      {dropLine && <DropLine edge={dropLine} />}
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
                {canAddSession && (
                  <button
                    type="button"
                    aria-label="Add session to this day"
                    title="Add session to this day"
                    className={cn("rounded p-1 hover:bg-[rgba(13,148,136,0.08)] hover:text-[#0d9488]", TEXT_MUTED)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddSession(e.currentTarget);
                    }}
                  >
                    <Plus className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Remove session"
                  className={cn("rounded p-1 hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]", TEXT_MUTED)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSession(session.uid);
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
          {exerciseCount > 0 && (
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
              {exerciseCount > SHOWN_EXERCISES && (
                <div className={cn(MONO_META_CLASS, "pl-[14px] text-[10px] text-[#c2d0cc]")}>
                  +{exerciseCount - SHOWN_EXERCISES} more
                </div>
              )}
            </div>
          )}

          {/* Foot: duration (or exercise count) · focus. */}
          <div className="mt-auto flex items-center justify-between gap-1.5 border-t border-[rgba(13,148,136,0.06)] pt-1.5">
            <span className={cn(MONO_META_CLASS, "text-[10px]")}>
              {session.estimatedDurationMinutes != null
                ? `${session.estimatedDurationMinutes} min`
                : `${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`}
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
  );
}
