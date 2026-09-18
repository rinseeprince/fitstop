"use client";

import type { UseFormRegister } from "react-hook-form";
import type { LogFormValues } from "./log-form-types";
import {
  buildSetDisplayNumbers,
  type PrescribedRow,
} from "@/utils/set-spec-rows";
import type { PrescribedField } from "@/utils/prescribed-fields";
import {
  LONE_EXERCISE,
  restAfterGroupedRow,
  type ExerciseGroupPlace,
} from "@/utils/exercise-group-display";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { BOX_LABELS, loggedBoxesFor, type LoggedBox } from "@/utils/set-log-measures";
import {
  pinnedCellClass,
  SET_CELL_OFFSET_PX,
  SET_GRID_BASE,
  SetRow,
  setGridTemplate,
} from "./set-row";
import { RestTimer } from "./rest-timer";

// The set grid, shared by the read-only prescription view and the log form.
// Both used to hand-roll their own header, which is how they drifted to
// different column counts.
//
// One box per column the coach prescribes (owner, 2026-09-18): the exercise's
// column list decides the boxes, in the columns' order, and nothing else is
// collected — the filter is a data-collection switch, not a display
// preference. Load's box is the weight box, so an exercise without Load has no
// weight box. When the boxes don't fit, the grid scrolls sideways with the tick
// and Set columns pinned, the same rule as the coach's readout.
type PrescribedSetGridProps = {
  /** The prescription, already flattened (drop sets expanded to sibling rows). */
  rows: PrescribedRow[];
  /** Which prescription columns the coach uses for this exercise (migration 183). */
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
  /** Fired after one of the row's boxes blurs, naming it, for the readback and the auto-tick. */
  onBlurBox?: (index: number, box: LoggedBox) => void;
  /** The box the last save could not read on this row, if any. */
  invalidBox?: (index: number) => LoggedBox | null;
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
  /**
   * Where the exercise sits in its group. In a superset or circuit each row is a
   * round and the rests between rows are the group's. Absent reads as a lone
   * exercise.
   */
  place?: Readonly<ExerciseGroupPlace>;
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
  onBlurBox,
  invalidBox,
  onRemove,
  canRemove,
  onCopyPrevious,
  canCopyPrevious,
  place = LONE_EXERCISE,
}: PrescribedSetGridProps) {
  const { preference } = useUnits();
  const rowCount = fieldIds ? fieldIds.length : rows.length;
  if (rowCount === 0) return null;
  const rowNoun = place.roundsAreRows ? "Round" : "Set";
  const boxes = loggedBoxesFor(fields);

  // The tick belongs to the log form, never to the read-only prescription view.
  // Decided once here so the header and every row cannot disagree about how many
  // columns the grid has.
  const withTick = fieldIds !== null;

  // Drop children repeat their top set's number, and a set the client appended
  // past the prescription has none of its own — so the displayed number is a
  // running count rather than the array index. Shared with the coach's readout
  // of this log, which has to agree about which row is "set 3".
  const displayNumbers = buildSetDisplayNumbers(rows, rowCount);

  // The header names the unit a bare load is typed in; every other box's value
  // carries its own unit or has none.
  const header = (box: LoggedBox) =>
    box === "load" ? `${BOX_LABELS.load} (${formatLoad(0, preference).unit})` : BOX_LABELS[box];

  return (
    <div className="overflow-x-auto">
      <div
        className={`${SET_GRID_BASE} px-3 pb-1`}
        style={{ gridTemplateColumns: setGridTemplate(boxes, withTick) }}
      >
        {withTick && <div className={`h-full ${pinnedCellClass(0, false)}`} />}
        <div className={`${HEADER_CLASS} h-full ${pinnedCellClass(withTick ? SET_CELL_OFFSET_PX : 0, false)}`}>
          {rowNoun}
        </div>
        {boxes.map((box) => (
          <div key={box} className={HEADER_CLASS}>
            {header(box)}
          </div>
        ))}
        <div />
      </div>

      <div className="space-y-1">
        {Array.from({ length: rowCount }, (_, i) => {
          const prescribed = rows[i];
          // Rest belongs AFTER the set it follows, and never between the drops
          // of one set — the whole point of a drop set is no rest. The kernel
          // owns that boundary question, because a drop set's rest sits on the
          // parent spec while the interval falls after its LAST row — and, in a
          // linked group, because what follows a row is the group's to say.
          // The Rest column gates the exercise's own rests, never the group's.
          const restSeconds = restAfterGroupedRow(
            rows,
            i,
            rowCount,
            place,
            fields.has("rest"),
          );

          return (
            <div key={fieldIds ? fieldIds[i] : i}>
              <SetRow
                setNumber={displayNumbers[i]}
                rowNoun={rowNoun}
                boxes={boxes}
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
                onBlurBox={onBlurBox ? (box) => onBlurBox(i, box) : undefined}
                invalidBox={invalidBox ? invalidBox(i) : null}
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
