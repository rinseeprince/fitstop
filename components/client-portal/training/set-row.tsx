import type { UseFormRegister, UseFormRegisterReturn } from "react-hook-form";
import { Copy, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { LogFormValues } from "./log-form-types";
import { useUnits } from "@/contexts/units-context";
import type { UnitSystem } from "@/utils/unit-conversions";
import { formatMeasureReadout } from "@/utils/measure-readout";
import { formatTargetReadout } from "@/utils/target-range";
import type { PrescribedRow } from "@/utils/set-spec-rows";
import type { PrescribedField } from "@/utils/prescribed-fields";
import { BOX_WORDS, boxEntry, type LoggedBox } from "@/utils/set-log-measures";

// The header row and every set row share this grid and must not drift, so the
// template is derived once from the same box list both are given.
//
// One box per column the coach prescribes (utils/set-log-measures.ts): the
// coach's target is the box's hint and the client types what they did. Load's
// box is the weight box — what they lifted, with the prescribed load as its
// hint — so Weight shows only when Load is on; there is no separate read-only
// Load cell. Set is the row's identity and is never a box; set_type gates the
// row's tag and rest gates the timer between rows.
//
// The tick is not a prescribed column either — it is the CLIENT's claim that
// the set was done, and it exists only in the log form. `withTick` is decided
// once, by the grid, and handed to both the header and every row for that
// reason.
export const SET_GRID_BASE = "grid items-center gap-2";

/** A box never narrower than its widest reading ("3:45–3:50 /km"); the grid scrolls sideways past that. */
const BOX_COLUMN = "minmax(96px,1fr)";
const TICK_COLUMN_PX = 32;
const SET_COLUMN_PX = 44;
const GAP_PX = 8;

export function setGridTemplate(boxes: readonly LoggedBox[], withTick: boolean): string {
  const columns = withTick ? [`${TICK_COLUMN_PX}px`, `${SET_COLUMN_PX}px`] : [`${SET_COLUMN_PX}px`];
  for (let i = 0; i < boxes.length; i++) columns.push(BOX_COLUMN);
  columns.push("56px");
  return columns.join(" ");
}

/**
 * The tick and Set cells stay put while the boxes scroll: sticky against the
 * grid's scrolling wrapper, each at its own offset, with an opaque background
 * so the boxes slide under them. The banked tint is an opaque approximation of
 * the row's translucent one, because a sticky cell cannot be see-through.
 */
export function pinnedCellClass(offsetPx: number, banked: boolean): string {
  // Literal class names, never interpolated: Tailwind only emits what it can
  // read in the source, so the one non-zero offset is spelled out.
  return `sticky z-[1] ${banked ? "bg-[#f5fbfa]" : "bg-white"} ${
    offsetPx === 0 ? "left-0" : "left-[40px]"
  }`;
}
/** The Set cell's offset behind the tick: the tick column plus the grid's gap. */
export const SET_CELL_OFFSET_PX = TICK_COLUMN_PX + GAP_PX;

// Every non-working set carries its type, the way Hevy and Strong tag them: a
// single letter beside the set number. Working sets are untagged because they
// are the default and a tag on every row is noise.
const TYPE_TAG = {
  warmup: { letter: "W", label: "Warm-up", className: "bg-[rgba(245,158,11,0.10)] text-[#b07520]" },
  drop: { letter: "D", label: "Drop set", className: "bg-[rgba(13,148,136,0.10)] text-[#0d9488]" },
  amrap: { letter: "A", label: "AMRAP", className: "bg-[rgba(13,148,136,0.10)] text-[#0d9488]" },
  failure: { letter: "F", label: "To failure", className: "bg-[rgba(192,96,96,0.10)] text-[#c06060]" },
  working: null,
} as const;

function SetTypeTag({ row }: { row?: PrescribedRow }) {
  const tag = row ? TYPE_TAG[row.setType] : null;
  if (!tag) return null;
  return (
    <span
      title={tag.label}
      aria-label={tag.label}
      className={`rounded-[4px] px-1 text-[10px] font-semibold leading-[16px] ${tag.className}`}
    >
      {tag.letter}
    </span>
  );
}

/**
 * The coach's target as the box's hint: a range reads with an en dash ("7–8",
 * "100–105 kg", "3:45–3:50 /km"). Boxes whose header already carries the word
 * (reps, RPE, RIR, cadence, resistance) hint the bare number; the converting
 * and unit-bearing measures hint with their unit, which is also how the box
 * reads back what it recorded.
 */
function boxHint(
  box: LoggedBox,
  prescribed: PrescribedRow | undefined,
  viewer: UnitSystem,
): string {
  if (!prescribed) return "";
  switch (box) {
    case "tempo":
      return prescribed.tempo ?? "";
    case "reps":
      return prescribed.repsTarget ?? formatTargetReadout(prescribed.ranges.reps) ?? "";
    case "rpe":
    case "rir":
    case "cadence":
    case "resistance":
      return formatTargetReadout(prescribed.ranges[box]) ?? "";
    case "load":
      return formatMeasureReadout("load", prescribed.ranges.load, viewer, prescribed.loadType) ?? "";
    default:
      return formatMeasureReadout(box, prescribed.ranges[box], viewer) ?? "";
  }
}

function inputModeFor(box: LoggedBox): "numeric" | "decimal" | "text" {
  switch (boxEntry(box)) {
    case "number":
      return box === "reps" || box === "calories" || box === "cadence" || box === "stroke_rate" || box === "heart_rate" || box === "power"
        ? "numeric"
        : "decimal";
    case "load":
      return "decimal";
    default:
      return "text";
  }
}

type SetRowProps = {
  setNumber: number;
  /** "Round" where the exercise's rows are a group's rounds. */
  rowNoun?: "Set" | "Round";
  /** The exercise's boxes, in the columns' order — decided by the grid. */
  boxes: readonly LoggedBox[];
  /** Which prescription columns this exercise uses (for the set-type tag). */
  fields: ReadonlySet<PrescribedField>;
  /**
   * This row's own prescription. Undefined for a set the CLIENT added beyond
   * what was prescribed (the log form lets them append rows), which renders
   * with empty hints rather than borrowing the previous row's.
   */
  prescribed?: PrescribedRow;
  register?: UseFormRegister<LogFormValues>;
  exerciseIndex?: number;
  setIndex?: number;
  /** Form mode only: draw the tick column. Decided by the grid, not here. */
  withTick?: boolean;
  /** Banked — "I did this set". Greys the row without disabling it. */
  completed?: boolean;
  onToggleComplete?: () => void;
  /**
   * Fired after a box loses focus, naming the box, so the row can show what it
   * recorded and auto-tick itself (locked decision 2). A client recording
   * numbers never touches a tick.
   */
  onBlurBox?: (box: LoggedBox) => void;
  /** The box the last save could not read, if any: it is marked and focused. */
  invalidBox?: LoggedBox | null;
  onCopyPrevious?: () => void;
  canCopyPrevious?: boolean;
  onRemove?: () => void;
};

// Compose the auto-tick onto react-hook-form's own blur handler rather than
// replacing it — RHF's runs the field's validation and touched-state bookkeeping.
function withBlur(
  field: UseFormRegisterReturn,
  onBlur: (() => void) | undefined,
): UseFormRegisterReturn {
  if (!onBlur) return field;
  return {
    ...field,
    onBlur: async (event) => {
      await field.onBlur(event);
      onBlur();
    },
  };
}

export function SetRow({
  setNumber,
  rowNoun = "Set",
  boxes,
  fields,
  prescribed,
  register,
  exerciseIndex,
  setIndex,
  withTick,
  completed,
  onToggleComplete,
  onBlurBox,
  invalidBox,
  onCopyPrevious,
  canCopyPrevious,
  onRemove,
}: SetRowProps) {
  // The client's own unit. It used to arrive as a prop carrying a mapper
  // constant, so every client logged under a "kg" label whatever they preferred.
  const { preference } = useUnits();
  const editable =
    register !== undefined && exerciseIndex != null && setIndex != null;

  // Banked rows read as done: muted, but never disabled. A client who ticks a
  // set and then remembers the weight has to be able to type it in.
  //
  // The muted tone is deliberately NOT #93b0b4, which is the Input primitive's
  // placeholder colour. A banked row used to render its entered values in
  // exactly that colour, so a typed 10 and an unfilled box hinting the
  // prescribed 10 were pixel-identical — a client believed they had recorded
  // reps they had not, and a coach reading the log saw real data that looked
  // like an empty field. Placeholder tone and value tone must never resolve to
  // the same token, in either direction.
  const banked = completed === true;
  const valueClass = banked ? "text-[#5a7d82]" : "";

  const setCell = (
    <div
      className={`flex h-full items-center justify-center gap-1 ${pinnedCellClass(
        withTick === true ? SET_CELL_OFFSET_PX : 0,
        banked,
      )}`}
    >
      {/* A drop shares its top set's number, so repeating it would read as a
          duplicate — the tag alone identifies the row. */}
      <span
        className={`text-[13px] font-mono-display ${banked ? "text-[#93b0b4]" : "text-[#5a7d82]"}`}
      >
        {prescribed?.dropIndex != null ? "" : setNumber}
      </span>
      {fields.has("set_type") && <SetTypeTag row={prescribed} />}
    </div>
  );

  if (!editable) {
    return (
      <div
        data-testid="set-row"
        className={`${SET_GRID_BASE} px-3 py-2`}
        style={{ gridTemplateColumns: setGridTemplate(boxes, false) }}
      >
        {setCell}
        {boxes.map((box) => (
          <ReadOnlyCell key={box} text={boxHint(box, prescribed, preference) || null} />
        ))}
        <span />
      </div>
    );
  }

  const namePrefix = `exercises.${exerciseIndex}.sets.${setIndex}.entries` as const;
  const showCopy = setIndex > 0 && onCopyPrevious !== undefined;

  return (
    <div
      data-testid="set-row"
      data-completed={banked ? "true" : "false"}
      className={`${SET_GRID_BASE} px-3 py-2 ${
        banked ? "rounded-[6px] bg-[rgba(13,148,136,0.04)]" : ""
      }`}
      style={{ gridTemplateColumns: setGridTemplate(boxes, withTick === true) }}
    >
      {withTick === true && (
        <div className={`flex h-full items-center justify-center ${pinnedCellClass(0, banked)}`}>
          <Checkbox
            checked={banked}
            onCheckedChange={() => onToggleComplete?.()}
            aria-label={`${rowNoun} ${setNumber} complete`}
            data-testid={`set-complete-${exerciseIndex}-${setIndex}`}
            className="size-5 border-[#93b0b4] data-[state=checked]:border-[#0d9488] data-[state=checked]:bg-[#0d9488]"
          />
        </div>
      )}

      {setCell}

      {boxes.map((box) => (
        <Input
          key={box}
          {...withBlur(register(`${namePrefix}.${box}`), onBlurBox ? () => onBlurBox(box) : undefined)}
          inputMode={inputModeFor(box)}
          type="text"
          placeholder={boxHint(box, prescribed, preference)}
          aria-label={`${rowNoun} ${setNumber} ${BOX_WORDS[box]}`}
          aria-invalid={invalidBox === box || undefined}
          data-testid={`box-${box}-${exerciseIndex}-${setIndex}`}
          className={`h-9 text-center text-[13px] font-mono-display ${valueClass}`}
        />
      ))}

      <div className="flex items-center justify-end gap-1">
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Delete ${rowNoun.toLowerCase()} ${setNumber}`}
            data-testid={`delete-set-${exerciseIndex}-${setIndex}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[#5a7d82] transition-colors hover:bg-[rgba(220,38,38,0.06)] hover:text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {showCopy ? (
          <button
            type="button"
            onClick={onCopyPrevious}
            disabled={canCopyPrevious === false}
            aria-label={`Copy previous ${rowNoun.toLowerCase()} into ${rowNoun.toLowerCase()} ${setNumber}`}
            data-testid={`copy-previous-${exerciseIndex}-${setIndex}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[#5a7d82] transition-colors hover:bg-[rgba(13,148,136,0.06)] hover:text-[#0d9488] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReadOnlyCell({ text }: { text: string | null }) {
  return (
    <div className="flex h-9 items-center justify-center rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.02)] text-[12px] font-mono-display text-[#93b0b4]">
      {text ?? "—"}
    </div>
  );
}
