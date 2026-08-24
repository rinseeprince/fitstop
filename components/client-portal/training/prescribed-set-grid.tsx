"use client";

import type { UseFormRegister } from "react-hook-form";
import type { LogFormValues } from "./log-form-types";
import {
  isContinuationOfDropSet,
  type PrescribedRow,
} from "@/utils/set-spec-rows";
import type { PrescribedField } from "@/utils/prescribed-fields";
import { SET_GRID_BASE, SetRow, setGridTemplate } from "./set-row";
import { RestTimer } from "./rest-timer";

// The set grid, shared by the read-only prescription view and the log form.
// Both used to hand-roll their own header, which is how they drifted to
// different column counts.
//
// LOAD and WEIGHT are deliberately separate columns. Load is the coach's
// instruction and may be a percentage; weight is the kilograms the client
// actually lifted. Cramming both into one box is what made a "% 1RM"
// prescription render as an empty field labelled KG.
type PrescribedSetGridProps = {
  /** The prescription, already flattened (drop sets expanded to sibling rows). */
  rows: PrescribedRow[];
  /**
   * Which prescription columns the coach uses for this exercise (migration
   * 149). Hidden columns are not rendered and therefore not collected — the
   * filter is a data-collection switch, not a display preference.
   */
  fields: ReadonlySet<PrescribedField>;
  /**
   * react-hook-form field ids. Present in form mode, and the source of the row
   * COUNT there — the client can append or delete sets, so the form can be
   * longer or shorter than the prescription. Null renders read-only.
   */
  fieldIds: string[] | null;
  register?: UseFormRegister<LogFormValues>;
  exerciseIndex?: number;
  /** Is this row banked? Form mode only. */
  isCompleted?: (index: number) => boolean;
  onToggleComplete?: (index: number) => void;
  /** Fired after one of the row's value fields blurs, for the auto-tick. */
  onRowBlur?: (index: number) => void;
  onRemove?: (index: number) => void;
  /**
   * Whether a row may be removed at all. Gates the affordance itself, because
   * the truthiness of `onRemove` alone drew a delete button on every row —
   * including prescribed ones, whose removal shifts every later row onto the
   * wrong spec and mistypes it. Absent means "all rows", for a caller with no
   * prescription to protect.
   */
  canRemove?: (index: number) => boolean;
  onCopyPrevious?: (index: number) => void;
  canCopyPrevious?: (index: number) => boolean;
};

const HEADER_CLASS =
  "text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] text-center";

export function PrescribedSetGrid({
  rows,
  fields,
  fieldIds,
  register,
  exerciseIndex,
  isCompleted,
  onToggleComplete,
  onRowBlur,
  onRemove,
  canRemove,
  onCopyPrevious,
  canCopyPrevious,
}: PrescribedSetGridProps) {
  const rowCount = fieldIds ? fieldIds.length : rows.length;
  if (rowCount === 0) return null;

  // The tick belongs to the log form, never to the read-only prescription view.
  // Decided once here so the header and every row cannot disagree about how many
  // columns the grid has.
  const withTick = fieldIds !== null;

  // Drop children repeat their top set's number, and a set the client appended
  // past the prescription has none of its own — so the displayed number is a
  // running count rather than the array index.
  const displayNumbers: number[] = [];
  let lastNumber = 0;
  for (let i = 0; i < rowCount; i++) {
    const prescribed = rows[i];
    if (prescribed?.dropIndex != null) {
      displayNumbers.push(lastNumber);
      continue;
    }
    lastNumber = prescribed?.setNumber ?? lastNumber + 1;
    displayNumbers.push(lastNumber);
  }

  return (
    <div>
      <div
        className={`${SET_GRID_BASE} px-3 pb-1`}
        style={{ gridTemplateColumns: setGridTemplate(fields, withTick) }}
      >
        {withTick && <div />}
        <div className={HEADER_CLASS}>Set</div>
        {fields.has("load") && <div className={HEADER_CLASS}>Load</div>}
        <div className={HEADER_CLASS}>Weight</div>
        {fields.has("reps") && <div className={HEADER_CLASS}>Reps</div>}
        {fields.has("rpe") && <div className={HEADER_CLASS}>RPE</div>}
        <div />
      </div>

      <div className="space-y-1">
        {Array.from({ length: rowCount }, (_, i) => {
          const prescribed = rows[i];
          // Rest belongs AFTER the set it follows, and never between the drops
          // of one set — the whole point of a drop set is no rest.
          const restSeconds =
            fields.has("rest") &&
            prescribed?.restSeconds != null &&
            prescribed.restSeconds > 0 &&
            i < rowCount - 1 &&
            !isContinuationOfDropSet(rows, i + 1)
              ? prescribed.restSeconds
              : null;

          return (
            <div key={fieldIds ? fieldIds[i] : i}>
              <SetRow
                setNumber={displayNumbers[i]}
                fields={fields}
                prescribed={prescribed}
                register={register}
                exerciseIndex={exerciseIndex}
                setIndex={fieldIds ? i : undefined}
                withTick={withTick}
                completed={isCompleted?.(i)}
                onToggleComplete={
                  onToggleComplete ? () => onToggleComplete(i) : undefined
                }
                onBlurRow={onRowBlur ? () => onRowBlur(i) : undefined}
                onRemove={
                  onRemove && (canRemove ? canRemove(i) : true)
                    ? () => onRemove(i)
                    : undefined
                }
                onCopyPrevious={
                  i > 0 && onCopyPrevious ? () => onCopyPrevious(i) : undefined
                }
                canCopyPrevious={
                  i > 0 && canCopyPrevious ? canCopyPrevious(i) : undefined
                }
              />
              {restSeconds !== null && <RestTimer seconds={restSeconds} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
