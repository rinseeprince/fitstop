import type { UseFormRegister, UseFormRegisterReturn } from "react-hook-form";
import { Copy, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { LogFormValues } from "./log-form-types";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { formatRepsRange } from "@/utils/reps-range";
import { formatPrescribedLoad, type PrescribedRow } from "@/utils/set-spec-rows";
import type { PrescribedField } from "@/utils/prescribed-fields";

// The header row and every set row share this grid and must not drift, so the
// template is derived once from the same field set both are given.
//
// Set and Weight have no toggle. Set is the row's identity, and Weight is the
// CLIENT's entry rather than a prescription column — it is what they lifted, and
// hiding it would stop collecting the data every strength metric is built from.
// Of the five prescribed fields only reps, load and rpe are columns; set_type
// gates the row tag and rest gates the timer between rows.
//
// The tick is not a prescribed field either — it is the CLIENT's claim that the
// set was done, and it exists only in the log form. `withTick` is decided once,
// by the grid, and handed to both the header and every row for that reason.
export const SET_GRID_BASE = "grid items-center gap-2";

export function setGridTemplate(
  fields: ReadonlySet<PrescribedField>,
  withTick: boolean,
): string {
  const columns = withTick ? ["32px", "44px"] : ["44px"];
  if (fields.has("load")) columns.push("minmax(0,0.9fr)");
  columns.push("minmax(0,1.1fr)");
  if (fields.has("reps")) columns.push("minmax(0,1fr)");
  if (fields.has("rpe")) columns.push("minmax(0,0.7fr)");
  columns.push("56px");
  return columns.join(" ");
}

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

export function SetTypeTag({ row }: { row?: PrescribedRow }) {
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

type SetRowProps = {
  setNumber: number;
  /** Which prescription columns this exercise uses. */
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
   * Fired after a value field loses focus, so the row can auto-tick itself
   * (locked decision 2). A client recording numbers never touches a tick.
   */
  onBlurRow?: () => void;
  onCopyPrevious?: () => void;
  canCopyPrevious?: boolean;
  onRemove?: () => void;
};

// Compose the auto-tick onto react-hook-form's own blur handler rather than
// replacing it — RHF's runs the field's validation and touched-state bookkeeping.
function withAutoTick(
  field: UseFormRegisterReturn,
  onBlurRow: (() => void) | undefined,
): UseFormRegisterReturn {
  if (!onBlurRow) return field;
  return {
    ...field,
    onBlur: async (event) => {
      await field.onBlur(event);
      onBlurRow();
    },
  };
}

export function SetRow({
  setNumber,
  fields,
  prescribed,
  register,
  exerciseIndex,
  setIndex,
  withTick,
  completed,
  onToggleComplete,
  onBlurRow,
  onCopyPrevious,
  canCopyPrevious,
  onRemove,
}: SetRowProps) {
  // The client's own unit. It used to arrive as a prop carrying a mapper
  // constant, so every client logged under a "kg" label whatever they preferred.
  const { preference } = useUnits();
  const loadUnit = formatLoad(0, preference).unit;
  const editable =
    register !== undefined && exerciseIndex != null && setIndex != null;

  // Load is the coach's INSTRUCTION and is never fillable — it may be a
  // percentage, which cannot share a box with the kilograms the client logs.
  // Absolute loads snap here (formatLoad, not displayLoad) because this is a
  // read-only readout, not an editable field that could round-trip the snap.
  const loadText = prescribed
    ? formatPrescribedLoad(
        prescribed,
        prescribed.loadValue != null
          ? String(formatLoad(prescribed.loadValue, preference).value)
          : "",
        loadUnit,
      )
    : null;

  const repsPlaceholder = prescribed
    ? prescribed.repsTarget ??
      formatRepsRange({ min: prescribed.repsMin, max: prescribed.repsMax })
    : "";
  const rpePlaceholder =
    prescribed?.rpeTarget != null ? String(prescribed.rpeTarget) : "";

  // Banked rows read as done: muted, but never disabled. A client who ticks a
  // set and then remembers the weight has to be able to type it in.
  const banked = completed === true;
  const valueClass = banked ? "text-[#93b0b4]" : "";

  const setCell = (
    <div className="flex items-center justify-center gap-1">
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
        style={{ gridTemplateColumns: setGridTemplate(fields, false) }}
      >
        {setCell}
        {fields.has("load") && <ReadOnlyCell text={loadText} />}
        <ReadOnlyCell text={null} />
        {fields.has("reps") && <ReadOnlyCell text={repsPlaceholder || null} />}
        {fields.has("rpe") && <ReadOnlyCell text={rpePlaceholder || null} />}
        <span />
      </div>
    );
  }

  const namePrefix = `exercises.${exerciseIndex}.sets.${setIndex}` as const;
  const showCopy = setIndex > 0 && onCopyPrevious !== undefined;

  return (
    <div
      data-testid="set-row"
      data-completed={banked ? "true" : "false"}
      className={`${SET_GRID_BASE} px-3 py-2 ${
        banked ? "rounded-[6px] bg-[rgba(13,148,136,0.04)]" : ""
      }`}
      style={{ gridTemplateColumns: setGridTemplate(fields, withTick === true) }}
    >
      {withTick === true && (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={banked}
            onCheckedChange={() => onToggleComplete?.()}
            aria-label={`Set ${setNumber} complete`}
            data-testid={`set-complete-${exerciseIndex}-${setIndex}`}
            className="size-5 border-[#93b0b4] data-[state=checked]:border-[#0d9488] data-[state=checked]:bg-[#0d9488]"
          />
        </div>
      )}

      {setCell}

      {fields.has("load") && (
        <div
          className={`truncate text-center text-[12px] font-mono-display ${
            banked ? "text-[#93b0b4]" : "text-[#5a7d82]"
          }`}
          data-testid={`prescribed-load-${exerciseIndex}-${setIndex}`}
        >
          {loadText ?? "—"}
        </div>
      )}

      <div className="relative">
        <Input
          {...withAutoTick(register(`${namePrefix}.weight`), onBlurRow)}
          inputMode="decimal"
          type="text"
          aria-label={`Set ${setNumber} weight`}
          className={`h-9 pr-9 text-center text-[13px] font-mono-display ${valueClass}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] uppercase tracking-[0.06em] text-[#93b0b4]">
          {loadUnit}
        </span>
      </div>

      {fields.has("reps") && (
        <Input
          {...withAutoTick(register(`${namePrefix}.reps`), onBlurRow)}
          inputMode="numeric"
          type="text"
          placeholder={repsPlaceholder}
          aria-label={`Set ${setNumber} reps`}
          className={`h-9 text-center text-[13px] font-mono-display ${valueClass}`}
        />
      )}

      {fields.has("rpe") && (
        <Input
          {...withAutoTick(register(`${namePrefix}.rpe`), onBlurRow)}
          inputMode="decimal"
          type="text"
          placeholder={rpePlaceholder}
          aria-label={`Set ${setNumber} RPE`}
          className={`h-9 text-center text-[13px] font-mono-display ${valueClass}`}
        />
      )}

      <div className="flex items-center justify-end gap-1">
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Delete set ${setNumber}`}
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
            aria-label={`Copy previous set into set ${setNumber}`}
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
