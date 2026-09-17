"use client";

import { useState } from "react";
import { Check, ChevronDown, Dumbbell, GripVertical, Trash2 } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import { buildPrescribedRows } from "@/utils/set-spec-rows";
import { formatRoundReps } from "@/utils/exercise-group-display";
import type { ExerciseDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import { setsRepsShort } from "./exercise-summary";
import { ExerciseCardBody } from "./exercise-card-body";
import { DropLine, type DropLineEdge } from "./drop-line";
import { exerciseDragId, type ExerciseDragData, type ExerciseDropData } from "./exercise-drop";
import {
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// One exercise inside the session editor: compact summary row (name, mono
// `4 × 8–12` projected from the compact columns — kept truthful by
// re-projection on every spec edit) that expands to per-set authoring plus
// the exercise-level fields (note, video URL). The legacy exercise-level
// isWarmup field is retired from authoring (owner decision: warm-ups are a
// per-set type now) — it still round-trips through the draft/serializer for
// legacy rows.
type ExerciseCardProps = {
  exercise: ExerciseDraft;
  // 1-based position in the session, counted straight through its groups —
  // rendered as the card's ordinal circle.
  ordinal: number;
  mode: "view" | "edit";
  // Controlled by the parent: only ONE exercise is open at a time, so the
  // session editor is not four stacked grids of inputs. Collapsing keeps the
  // draft (every edit commits on blur), it does not discard.
  expanded: boolean;
  onToggleExpanded: () => void;
  /**
   * Cards are borderless on the session editor's grey body (spacing separates)
   * and bordered on the three white-bodied surfaces that share this component,
   * where white-on-white would vanish.
   */
  bordered?: boolean;
  /** In a superset or circuit: its rows are the group's rounds. */
  roundsAreRows: boolean;
  /** What the card is as a drop target, and the id it registers under. */
  drop: { id: string; data: ExerciseDropData };
  /** Where a drop would land against this card, drawn as a line; null for none. */
  dropLine: DropLineEdge | null;
  /** Picking exercises to link: the header toggles the pick. Null otherwise. */
  pick: { picked: boolean; onToggle: () => void } | null;
  onEdit: (patch: Partial<ExerciseDraft>) => void;
  onSpecEdit: (edit: SetSpecEdit) => void;
  onRemove: () => void;
};

export function ExerciseCard({
  exercise,
  ordinal,
  mode,
  expanded,
  onToggleExpanded,
  bordered = true,
  roundsAreRows,
  drop,
  dropLine,
  pick,
  onEdit,
  onSpecEdit,
  onRemove,
}: ExerciseCardProps) {
  const [videoInvalid, setVideoInvalid] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const editable = mode === "edit";

  const dragData: ExerciseDragData = { type: "exercise", exerciseUid: exercise.uid };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    transform,
    isDragging,
  } = useDraggable({ id: exerciseDragId(exercise.uid), data: dragData, disabled: !editable || pick != null });
  const { setNodeRef: setDropRef } = useDroppable({ id: drop.id, data: drop.data, disabled: !editable });

  // In a superset or circuit the reps read round by round, as the client sees
  // them; a round that asks no rep count leaves nothing half-true on screen.
  const summary = roundsAreRows
    ? (formatRoundReps(buildPrescribedRows(expandSetSpecs(exercise))) ?? "")
    : setsRepsShort(exercise);

  const commitVideoUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setVideoInvalid(false);
      onEdit({ videoUrl: null });
      return;
    }
    try {
      new URL(trimmed);
      setVideoInvalid(false);
      onEdit({ videoUrl: trimmed });
    } catch {
      // Invalid URLs never enter the draft — they'd fail videoUrlSchema and
      // 400 the whole save.
      setVideoInvalid(true);
      onEdit({ videoUrl: null });
    }
  };

  const ordinalCircle = (
    <span
      className={cn(
        MONO,
        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
        pick?.picked ? "bg-[#0d9488] text-white" : "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]",
      )}
    >
      {pick?.picked ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : ordinal}
    </span>
  );
  const identity = (
    <>
      <span className={cn(THUMB_CLASS, "h-7 w-7")}>
        <Dumbbell className="h-3.5 w-3.5" strokeWidth={1.5} />
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-left text-[13px] font-semibold", TEXT_PRIMARY)}>
        {exercise.name}
      </span>
      {exercise.notes && <span className={cn("shrink-0", CHIP_NEUTRAL_CLASS)}>Notes</span>}
      <span className={cn(MONO, "shrink-0 text-[11px]", TEXT_SECONDARY)}>{summary}</span>
    </>
  );

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "group/ex relative rounded-[6px] bg-white transition-shadow",
        // Borderless only where the body behind it is #f4f7f6 and spacing can
        // do the separating (design system, "Spacing Principles").
        bordered && TRAINING_CARD_BORDER,
        !expanded && "hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
        pick?.picked && "ring-1 ring-inset ring-[#0d9488]",
        isDragging && "z-10 opacity-40",
      )}
    >
      {dropLine && <DropLine edge={dropLine} />}
      {pick ? (
        // Picking exercises to link: the whole row is the toggle. The grip,
        // remove and chevron give up their places rather than their space, so
        // nothing on the row moves.
        <button
          type="button"
          role="checkbox"
          aria-checked={pick.picked}
          aria-label={exercise.name}
          className={cn("flex w-full items-center gap-2 rounded-[6px] p-2", FOCUS_RING)}
          onClick={pick.onToggle}
        >
          <span aria-hidden className="-mr-0.5 h-[18px] w-[18px] shrink-0" />
          {ordinalCircle}
          {identity}
          <span aria-hidden className="h-5 w-5 shrink-0" />
          <span aria-hidden className="h-[22px] w-[22px] shrink-0" />
        </button>
      ) : (
        <div className="flex items-center gap-2 p-2">
          {editable && (
            <button
              type="button"
              aria-label={`Drag ${exercise.name}`}
              className={cn(
                "-mr-0.5 cursor-grab rounded p-0.5 opacity-0 transition-opacity hover:bg-[rgba(13,148,136,0.08)] active:cursor-grabbing group-hover/ex:opacity-100 group-focus-within/ex:opacity-100",
                TEXT_MUTED,
              )}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          {ordinalCircle}
          {identity}
          {editable && (
            <button
              type="button"
              aria-label={`Remove ${exercise.name}`}
              className="rounded p-1 text-destructive opacity-0 transition-opacity hover:bg-red-50 group-hover/ex:opacity-100 group-focus-within/ex:opacity-100"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            aria-label={expanded ? "Collapse sets" : "Expand sets"}
            aria-expanded={expanded}
            className={cn(
              "rounded p-1 opacity-0 transition-opacity hover:bg-[rgba(13,148,136,0.08)] group-hover/ex:opacity-100 group-focus-within/ex:opacity-100",
              expanded && "opacity-100",
              TEXT_SECONDARY,
            )}
            onClick={onToggleExpanded}
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform duration-200", !expanded && "-rotate-90")}
              strokeWidth={1.5}
            />
          </button>
        </div>
      )}

      {expanded && !pick && (
        <ExerciseCardBody
          exercise={exercise}
          editable={editable}
          roundsAreRows={roundsAreRows}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
          videoInvalid={videoInvalid}
          onVideoUrlBlur={commitVideoUrl}
          onEdit={onEdit}
          onSpecEdit={onSpecEdit}
        />
      )}
    </div>
  );
}
