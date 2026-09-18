"use client";

import { ChevronDown, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import { resolvePrescribedFields, type PrescribedField } from "@/utils/prescribed-fields";
import { orderColumns, presetColumns, presetOf } from "@/utils/column-presets";
import type { ExerciseDraft } from "./program-builder-types";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import {
  COLUMN_HEADERS,
  PINNED_CELL_CLASS,
  SET_GRID_BASE,
  SetRowEditor,
  setGridTemplate,
} from "./set-row-editor";
import { SetColumnsMenu } from "./set-columns-menu";
import { FOCUS_RING, LABEL_CLASS } from "./builder-tokens";

// An exercise card's open body: the per-set grid — one column per column the
// exercise prescribes, scrolling sideways with the number cell pinned when
// they don't fit — then the exercise-level fields (video URL, coach note)
// behind their own disclosure.
//
// `roundsAreRows`: the exercise is in a superset or circuit, so its rows are
// the group's rounds. The first column reads Round, rows are added and removed
// only by the group's Rounds setting, and there is no Rest column — the
// group's rests are what the client gets. The exercise's own rests and its
// Rest column choice stay stored and apply again if it's unlinked.
type ExerciseCardBodyProps = {
  exercise: ExerciseDraft;
  editable: boolean;
  roundsAreRows: boolean;
  // The card owns these, so they survive the card collapsing.
  detailsOpen: boolean;
  onToggleDetails: () => void;
  videoInvalid: boolean;
  onVideoUrlBlur: (raw: string) => void;
  onEdit: (patch: Partial<ExerciseDraft>) => void;
  onSpecEdit: (edit: SetSpecEdit) => void;
};

const ROUND_HIDDEN_FIELDS: readonly PrescribedField[] = ["rest"];

export function ExerciseCardBody({
  exercise,
  editable,
  roundsAreRows,
  detailsOpen,
  onToggleDetails,
  videoInvalid,
  onVideoUrlBlur,
  onEdit,
  onSpecEdit,
}: ExerciseCardBodyProps) {
  const specs = expandSetSpecs(exercise);
  // Which prescription columns this exercise uses. Not a display preference:
  // it decides what the client app renders and can enter (migration 149).
  const fields = resolvePrescribedFields(exercise.prescribedFields);
  const hidden = roundsAreRows ? ROUND_HIDDEN_FIELDS : [];
  const shown = roundsAreRows
    ? new Set([...fields].filter((field) => !hidden.includes(field)))
    : fields;

  return (
    <div className="space-y-1 border-t border-[rgba(13,148,136,0.08)] p-2">
      {/* The grid scrolls sideways when its columns don't fit the card; the
          half-pixel margins leave room for the boxes' focus rings at the
          scroll edge. */}
      <div className="-mx-0.5 space-y-1 overflow-x-auto px-0.5">
        {/* Column header for the set rows */}
        <div
          className={cn(SET_GRID_BASE, LABEL_CLASS)}
          style={{ gridTemplateColumns: setGridTemplate(shown, roundsAreRows) }}
        >
          <span className={cn("text-center", PINNED_CELL_CLASS)}>
            {roundsAreRows ? "Round" : "#"}
          </span>
          {orderColumns(shown).map((field) => (
            <span key={field}>{COLUMN_HEADERS[field]}</span>
          ))}
          {/* The picker sits at the end of the row it governs, in the cell
              the duplicate/remove icons occupy below. */}
          <span className="flex justify-end">
            {editable && (
              <SetColumnsMenu
                fields={fields}
                hiddenFields={hidden}
                activePreset={presetOf(fields, hidden)}
                subject={exercise.name}
                onChange={(prescribedFields) => onEdit({ prescribedFields })}
                onPreset={(preset) =>
                  onEdit({ prescribedFields: presetColumns(preset, fields, hidden) })
                }
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
            fields={shown}
            index={i}
            disabled={!editable}
            isRound={roundsAreRows}
            onEdit={onSpecEdit}
          />
        ))}
      </div>
      {editable && !roundsAreRows && (
        <button
          type="button"
          className={cn("flex items-center gap-1 py-1", LABEL_CLASS, "hover:text-[#0d9488]")}
          onClick={() => onSpecEdit({ kind: "add-set" })}
        >
          <Plus className="h-3 w-3" strokeWidth={1.5} /> Add set
        </button>
      )}

      {/* Video URL + coach note — tucked behind a text action (two fields most
          exercises never use should not push the set grid down), two columns
          when opened, above a hairline. */}
      <div className="pt-1">
        <button
          type="button"
          aria-expanded={detailsOpen}
          className={cn("flex items-center gap-1.5 py-1", LABEL_CLASS, "hover:text-[#0d9488]")}
          onClick={onToggleDetails}
        >
          Video &amp; note
          <ChevronDown
            className={cn("h-3 w-3 transition-transform duration-200", !detailsOpen && "-rotate-90")}
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
                className={cn("h-7 bg-white px-2 text-xs", FOCUS_RING, videoInvalid && "border-destructive")}
                onBlur={(e) => onVideoUrlBlur(e.target.value)}
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
  );
}
