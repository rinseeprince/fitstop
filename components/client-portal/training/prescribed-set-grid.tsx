"use client";

import type { UseFormRegister } from "react-hook-form";
import type { LogFormValues } from "./log-form-types";
import { isContinuationOfDropSet, type PrescribedRow } from "@/utils/set-spec-rows";
import { SET_GRID, SetRow } from "./set-row";
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
   * react-hook-form field ids. Present in form mode, and the source of the row
   * COUNT there — the client can append or delete sets, so the form can be
   * longer or shorter than the prescription. Null renders read-only.
   */
  fieldIds: string[] | null;
  register?: UseFormRegister<LogFormValues>;
  exerciseIndex?: number;
  disabled?: boolean;
  onRemove?: (index: number) => void;
  onCopyPrevious?: (index: number) => void;
  canCopyPrevious?: (index: number) => boolean;
};

const HEADER_CLASS =
  "text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] text-center";

export function PrescribedSetGrid({
  rows,
  fieldIds,
  register,
  exerciseIndex,
  disabled,
  onRemove,
  onCopyPrevious,
  canCopyPrevious,
}: PrescribedSetGridProps) {
  const rowCount = fieldIds ? fieldIds.length : rows.length;
  if (rowCount === 0) return null;

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
      <div className={`${SET_GRID} px-3 pb-1`}>
        <div className={HEADER_CLASS}>Set</div>
        <div className={HEADER_CLASS}>Load</div>
        <div className={HEADER_CLASS}>Weight</div>
        <div className={HEADER_CLASS}>Reps</div>
        <div className={HEADER_CLASS}>RPE</div>
        <div />
      </div>

      <div className="space-y-1">
        {Array.from({ length: rowCount }, (_, i) => {
          const prescribed = rows[i];
          // Rest belongs AFTER the set it follows, and never between the drops
          // of one set — the whole point of a drop set is no rest.
          const restSeconds =
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
                prescribed={prescribed}
                register={register}
                exerciseIndex={exerciseIndex}
                setIndex={fieldIds ? i : undefined}
                disabled={disabled}
                onRemove={onRemove ? () => onRemove(i) : undefined}
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
