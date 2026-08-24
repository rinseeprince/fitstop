"use client";

import { useState } from "react";
import { ChevronDown, Dumbbell, GripVertical, Plus, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import type { ExerciseDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import { setsRepsShort } from "./exercise-summary";
import { SET_GRID_BASE, SetRowEditor, setGridTemplate } from "./set-row-editor";
import { SetColumnsMenu } from "./set-columns-menu";
import { resolvePrescribedFields } from "@/utils/prescribed-fields";
import {
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// One exercise inside the session editor: compact summary row (name, mono
// `4 × 8–12 @ RPE 8` projected from the compact columns — kept truthful by
// re-projection on every spec edit) that expands to per-set authoring plus
// the exercise-level fields (note, video URL). The legacy exercise-level
// supersetGroup/isWarmup fields are retired from authoring (owner decision:
// warm-ups are a per-set type now, supersets never became functional) —
// they still round-trip through the draft/serializer for legacy rows.
type ExerciseCardProps = {
  exercise: ExerciseDraft;
  // 1-based position in the session — rendered as the block's ord circle.
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
  onEdit,
  onSpecEdit,
  onRemove,
}: ExerciseCardProps) {
  const [videoInvalid, setVideoInvalid] = useState(false);
  // Video URL + coach note are tucked behind a text action: two fields most
  // exercises never use should not push the set grid down the sheet.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const editable = mode === "edit";
  const specs = expandSetSpecs(exercise);
  // Which prescription columns this exercise uses. Not a display preference:
  // it decides what the client app renders and can enter (migration 149).
  const fields = resolvePrescribedFields(exercise.prescribedFields);

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
        "group/ex rounded-[6px] bg-white transition-shadow",
        // Borderless only where the body behind it is #f4f7f6 and spacing can
        // do the separating (design system, "Spacing Principles").
        bordered && TRAINING_CARD_BORDER,
        !expanded && "hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
        isDragging && "opacity-40",
      )}
    >
      {/* Compact header row */}
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
        <span className={cn(MONO, "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[rgba(13,148,136,0.08)] text-[11px] font-semibold text-[#0a5c55]")}>
          {ordinal}
        </span>
        <span className={cn(THUMB_CLASS, "h-7 w-7")}>
          <Dumbbell className="h-3.5 w-3.5" strokeWidth={1.5} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold", TEXT_PRIMARY)}>
          {exercise.name}
        </span>
        {exercise.notes && (
          <span className={cn("shrink-0", CHIP_NEUTRAL_CLASS)}>
            Notes
          </span>
        )}
        <span className={cn(MONO, "shrink-0 text-[11px]", TEXT_SECONDARY)}>
          {setsRepsShort(exercise)}
        </span>
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

      {expanded && (
        <div className="space-y-1 border-t border-[rgba(13,148,136,0.08)] p-2">
          {/* Column header for the set rows */}
          <div
            className={cn(SET_GRID_BASE, LABEL_CLASS)}
            style={{ gridTemplateColumns: setGridTemplate(fields) }}
          >
            <span className="text-center">#</span>
            {fields.has("set_type") && <span>Type</span>}
            {fields.has("reps") && <span>Reps</span>}
            {fields.has("load") && <span>Load</span>}
            {fields.has("rpe") && <span>RPE</span>}
            {fields.has("rest") && <span>Rest s</span>}
            {/* The picker sits at the end of the row it governs, in the cell
                the duplicate/remove icons occupy below. */}
            <span className="flex justify-end">
              {editable && (
                <SetColumnsMenu
                  fields={fields}
                  exerciseName={exercise.name}
                  onChange={(prescribedFields) => onEdit({ prescribedFields })}
                />
              )}
            </span>
          </div>
          {specs.map((spec, i) => (
            <SetRowEditor
              // Re-key on list length so removals remount rows and their
              // uncontrolled inputs re-read defaultValue.
              key={`${exercise.uid}-${i}-${specs.length}`}
              spec={spec}
              fields={fields}
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

          {/* Video URL + coach note — collapsed by default, two columns when
              opened, above a hairline. */}
          <div className="pt-1">
            <button
              type="button"
              aria-expanded={detailsOpen}
              className={cn(
                "flex items-center gap-1.5 py-1",
                LABEL_CLASS,
                "hover:text-[#0d9488]",
              )}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              Video &amp; note
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform duration-200",
                  !detailsOpen && "-rotate-90",
                )}
                strokeWidth={1.5}
              />
            </button>

            {detailsOpen && (
              <div className="mt-2 grid grid-cols-1 gap-3 border-t border-[rgba(13,148,136,0.06)] pt-2.5 sm:grid-cols-2">
                <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                  Video URL
                  <Input
                    disabled={!editable}
                    maxLength={500}
                    defaultValue={exercise.videoUrl ?? ""}
                    placeholder="https://…"
                    aria-invalid={videoInvalid}
                    className={cn(
                      "h-7 bg-white px-2 text-xs",
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
                <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                  Coach note
                  <Textarea
                    disabled={!editable}
                    maxLength={500}
                    defaultValue={exercise.notes ?? ""}
                    placeholder="Cues the client sees with this exercise"
                    className={cn("min-h-14 bg-white px-2 py-1.5 text-xs", FOCUS_RING)}
                    onBlur={(e) => onEdit({ notes: e.target.value.trim() || null })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
