"use client";

import { useState } from "react";
import { ChevronDown, GripVertical, Plus, Trash2, Video } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import type { ExerciseDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import { SET_GRID, SetRowEditor } from "./set-row-editor";
import {
  FOCUS_RING,
  LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// One exercise inside the session editor: compact summary row (name, badges,
// mono `4 × 8–12 @ RPE 8` projected from the compact columns — kept truthful
// by re-projection on every spec edit) that expands to per-set authoring plus
// the exercise-level fields (warm-up, superset, note, video URL).
type ExerciseCardProps = {
  exercise: ExerciseDraft;
  mode: "view" | "edit";
  onEdit: (patch: Partial<ExerciseDraft>) => void;
  onSpecEdit: (edit: SetSpecEdit) => void;
  onRemove: () => void;
};

function compactSummary(e: ExerciseDraft): string {
  const range =
    e.repsMin != null || e.repsMax != null
      ? `${e.repsMin ?? "?"}–${e.repsMax ?? "?"}`
      : null;
  // With authored specs the compact range IS the maintained projection —
  // prefer it over an exercise-level repsTarget that per-set edits never
  // update (it would show stale reps after editing sets).
  const reps =
    e.setSpecs && e.setSpecs.length > 0
      ? range ?? e.repsTarget
      : e.repsTarget ?? range;
  const base = reps ? `${e.sets} × ${reps}` : `${e.sets} sets`;
  return e.rpeTarget != null ? `${base} @ RPE ${e.rpeTarget}` : base;
}

export function ExerciseCard({
  exercise,
  mode,
  onEdit,
  onSpecEdit,
  onRemove,
}: ExerciseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [videoInvalid, setVideoInvalid] = useState(false);
  const editable = mode === "edit";
  const specs = expandSetSpecs(exercise);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: exercise.uid, disabled: !editable });

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

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-[6px] bg-white",
        TRAINING_CARD_BORDER,
        isDragging && "opacity-40",
      )}
    >
      {/* Compact header row */}
      <div className="flex items-center gap-1.5 p-2">
        {editable && (
          <button
            type="button"
            aria-label={`Drag ${exercise.name}`}
            className={cn("cursor-grab rounded p-1 hover:bg-[rgba(13,148,136,0.08)] active:cursor-grabbing", TEXT_MUTED)}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        <span className={cn("min-w-0 flex-1 truncate text-xs font-semibold", TEXT_PRIMARY)}>
          {exercise.name}
        </span>
        {exercise.isWarmup && (
          <span className="rounded-[3px] bg-[rgba(13,148,136,0.05)] px-1 py-px text-[9px] font-semibold uppercase tracking-[0.06em] text-[#5a7d82]">
            Warm-up
          </span>
        )}
        {exercise.supersetGroup && (
          <span className="rounded-[3px] bg-[rgba(13,148,136,0.08)] px-1 py-px text-[9px] font-semibold uppercase tracking-[0.06em] text-[#0d9488]">
            SS {exercise.supersetGroup}
          </span>
        )}
        {exercise.videoUrl && (
          <Video className={cn("h-3 w-3 shrink-0", TEXT_SECONDARY)} strokeWidth={1.5} />
        )}
        <span className={cn("shrink-0 font-mono text-[11px]", TEXT_SECONDARY)}>
          {compactSummary(exercise)}
        </span>
        {editable && (
          <button
            type="button"
            aria-label={`Remove ${exercise.name}`}
            className="rounded p-1 text-destructive hover:bg-red-50"
            onClick={onRemove}
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          aria-label={expanded ? "Collapse sets" : "Expand sets"}
          aria-expanded={expanded}
          className={cn("rounded p-1 hover:bg-[rgba(13,148,136,0.08)]", TEXT_SECONDARY)}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-200", !expanded && "-rotate-90")}
            strokeWidth={1.5}
          />
        </button>
      </div>

      {expanded && (
        <div className="space-y-1 border-t border-[rgba(13,148,136,0.08)] p-2">
          {/* Column header for the set rows */}
          <div className={cn(SET_GRID, LABEL_CLASS)}>
            <span className="text-center">#</span>
            <span>Type</span>
            <span>Reps</span>
            <span>Load</span>
            <span>RPE</span>
            <span>Tempo</span>
            <span>Rest s</span>
            <span />
          </div>
          {specs.map((spec, i) => (
            <SetRowEditor
              // Re-key on list length so removals remount rows and their
              // uncontrolled inputs re-read defaultValue.
              key={`${exercise.uid}-${i}-${specs.length}`}
              spec={spec}
              index={i}
              disabled={!editable}
              onEdit={onSpecEdit}
            />
          ))}
          {editable && (
            <button
              type="button"
              className={cn("flex items-center gap-1 py-1", LABEL_CLASS, "hover:text-[#0d9488]")}
              onClick={() => onSpecEdit({ kind: "add-set" })}
            >
              <Plus className="h-3 w-3" strokeWidth={1.5} /> Add set
            </button>
          )}

          {/* Exercise-level fields */}
          <div className="grid grid-cols-2 gap-2 border-t border-[rgba(13,148,136,0.08)] pt-2">
            <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
              Superset group
              <Input
                disabled={!editable}
                maxLength={10}
                defaultValue={exercise.supersetGroup ?? ""}
                placeholder="e.g. A"
                className={cn("h-7 px-2 text-xs", FOCUS_RING)}
                onBlur={(e) => onEdit({ supersetGroup: e.target.value.trim() || null })}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Warm-up exercise</span>
              <label className={cn("flex h-7 items-center gap-2 text-xs", TEXT_SECONDARY)}>
                <Checkbox
                  disabled={!editable}
                  checked={exercise.isWarmup}
                  onCheckedChange={(checked) => onEdit({ isWarmup: checked === true })}
                />
                Counts as warm-up work
              </label>
            </div>
            <label className={cn("col-span-2 flex flex-col gap-1", LABEL_CLASS)}>
              Video URL
              <Input
                disabled={!editable}
                maxLength={500}
                defaultValue={exercise.videoUrl ?? ""}
                placeholder="https://…"
                aria-invalid={videoInvalid}
                className={cn(
                  "h-7 px-2 text-xs",
                  FOCUS_RING,
                  videoInvalid && "border-destructive",
                )}
                onBlur={(e) => commitVideoUrl(e.target.value)}
              />
              {videoInvalid && (
                <span className="text-[10px] normal-case tracking-normal text-destructive">
                  Not a valid link — it won&apos;t be saved
                </span>
              )}
            </label>
            <label className={cn("col-span-2 flex flex-col gap-1", LABEL_CLASS)}>
              Coach note
              <Textarea
                disabled={!editable}
                maxLength={500}
                defaultValue={exercise.notes ?? ""}
                placeholder="Cues the client sees with this exercise"
                className={cn("min-h-14 px-2 py-1.5 text-xs", FOCUS_RING)}
                onBlur={(e) => onEdit({ notes: e.target.value.trim() || null })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
