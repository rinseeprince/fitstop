import type { UseFormRegister } from "react-hook-form";
import { Copy, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { LogFormValues } from "./log-form-types";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { formatRepsRange } from "@/utils/reps-range";
import { formatPrescribedLoad, type PrescribedRow } from "@/utils/set-spec-rows";

// One template shared by the header row and every set row — they are a grid and
// must not drift. Set · Load · Weight · Reps · RPE · actions.
export const SET_GRID =
  "grid grid-cols-[44px_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.7fr)_56px] items-center gap-2";

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
  /**
   * This row's own prescription. Undefined for a set the CLIENT added beyond
   * what was prescribed (the log form lets them append rows), which renders
   * with empty hints rather than borrowing the previous row's.
   */
  prescribed?: PrescribedRow;
  register?: UseFormRegister<LogFormValues>;
  exerciseIndex?: number;
  setIndex?: number;
  disabled?: boolean;
  onCopyPrevious?: () => void;
  canCopyPrevious?: boolean;
  onRemove?: () => void;
};

export function SetRow({
  setNumber,
  prescribed,
  register,
  exerciseIndex,
  setIndex,
  disabled,
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

  const setCell = (
    <div className="flex items-center justify-center gap-1">
      {/* A drop shares its top set's number, so repeating it would read as a
          duplicate — the tag alone identifies the row. */}
      <span className="text-[13px] font-mono-display text-[#5a7d82]">
        {prescribed?.dropIndex != null ? "" : setNumber}
      </span>
      <SetTypeTag row={prescribed} />
    </div>
  );

  if (!editable) {
    return (
      <div data-testid="set-row" className={`${SET_GRID} px-3 py-2`}>
        {setCell}
        <ReadOnlyCell text={loadText} />
        <ReadOnlyCell text={null} />
        <ReadOnlyCell text={repsPlaceholder || null} />
        <ReadOnlyCell text={rpePlaceholder || null} />
        <span />
      </div>
    );
  }

  const namePrefix = `exercises.${exerciseIndex}.sets.${setIndex}` as const;
  const showCopy = setIndex > 0 && onCopyPrevious !== undefined;

  return (
    <div data-testid="set-row" className={`${SET_GRID} px-3 py-2`}>
      {setCell}

      <div
        className="truncate text-center text-[12px] font-mono-display text-[#5a7d82]"
        data-testid={`prescribed-load-${exerciseIndex}-${setIndex}`}
      >
        {loadText ?? "—"}
      </div>

      <div className="relative">
        <Input
          {...register(`${namePrefix}.weight`)}
          inputMode="decimal"
          type="text"
          disabled={disabled}
          aria-label={`Set ${setNumber} weight`}
          className="h-9 pr-9 text-center text-[13px] font-mono-display"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] uppercase tracking-[0.06em] text-[#93b0b4]">
          {loadUnit}
        </span>
      </div>

      <Input
        {...register(`${namePrefix}.reps`)}
        inputMode="numeric"
        type="text"
        disabled={disabled}
        placeholder={repsPlaceholder}
        aria-label={`Set ${setNumber} reps`}
        className="h-9 text-center text-[13px] font-mono-display"
      />

      <Input
        {...register(`${namePrefix}.rpe`)}
        inputMode="decimal"
        type="text"
        disabled={disabled}
        placeholder={rpePlaceholder}
        aria-label={`Set ${setNumber} RPE`}
        className="h-9 text-center text-[13px] font-mono-display"
      />

      <div className="flex items-center justify-end gap-1">
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
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
            disabled={disabled || canCopyPrevious === false}
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
