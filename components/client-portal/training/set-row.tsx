import type { UseFormRegister } from "react-hook-form";
import { Copy, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { LogFormValues } from "./log-form-types";

type SetRowProps = {
  setNumber: number;
  weightPlaceholder?: string;
  repsPlaceholder?: string;
  rpePlaceholder?: string;
  register?: UseFormRegister<LogFormValues>;
  exerciseIndex?: number;
  setIndex?: number;
  weightUnit?: "lbs" | "kg";
  disabled?: boolean;
  onCopyPrevious?: () => void;
  canCopyPrevious?: boolean;
  onRemove?: () => void;
};

export function SetRow({
  setNumber,
  weightPlaceholder,
  repsPlaceholder,
  rpePlaceholder,
  register,
  exerciseIndex,
  setIndex,
  weightUnit,
  disabled,
  onCopyPrevious,
  canCopyPrevious,
  onRemove,
}: SetRowProps) {
  const editable =
    register !== undefined && exerciseIndex != null && setIndex != null;

  if (!editable) {
    return (
      <div
        data-testid="set-row"
        className="grid grid-cols-12 items-center gap-2 px-3 py-2"
      >
        <div className="col-span-2 text-center text-[13px] font-mono-display text-[#5a7d82]">
          {setNumber}
        </div>
        <PlaceholderCell colSpan={4} hint={weightPlaceholder} />
        <PlaceholderCell colSpan={3} hint={repsPlaceholder} />
        <PlaceholderCell colSpan={3} hint={rpePlaceholder} />
      </div>
    );
  }

  const namePrefix = `exercises.${exerciseIndex}.sets.${setIndex}` as const;
  const showCopy = setIndex > 0 && onCopyPrevious !== undefined;

  return (
    <div
      data-testid="set-row"
      className="grid grid-cols-12 items-center gap-2 px-3 py-2"
    >
      <div className="col-span-1 text-center text-[13px] font-mono-display text-[#5a7d82]">
        {setNumber}
      </div>
      <div className="col-span-3">
        <div className="relative">
          <Input
            {...register(`${namePrefix}.weight`)}
            inputMode="decimal"
            type="text"
            disabled={disabled}
            placeholder={weightPlaceholder ?? ""}
            aria-label={`Set ${setNumber} weight`}
            className="h-9 pr-9 text-center text-[13px] font-mono-display"
          />
          {weightUnit && (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] uppercase tracking-[0.06em] text-[#93b0b4]">
              {weightUnit}
            </span>
          )}
        </div>
      </div>
      <div className="col-span-3">
        <Input
          {...register(`${namePrefix}.reps`)}
          inputMode="numeric"
          type="text"
          disabled={disabled}
          placeholder={repsPlaceholder ?? ""}
          aria-label={`Set ${setNumber} reps`}
          className="h-9 text-center text-[13px] font-mono-display"
        />
      </div>
      <div className="col-span-3">
        <Input
          {...register(`${namePrefix}.rpe`)}
          inputMode="decimal"
          type="text"
          disabled={disabled}
          placeholder={rpePlaceholder ?? ""}
          aria-label={`Set ${setNumber} RPE`}
          className="h-9 text-center text-[13px] font-mono-display"
        />
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1">
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

function PlaceholderCell({
  colSpan,
  hint,
}: {
  colSpan: 3 | 4;
  hint: string | undefined;
}) {
  const span = colSpan === 4 ? "col-span-4" : "col-span-3";
  return (
    <div className={span}>
      <div className="flex h-9 items-center justify-center rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.02)] text-[12px] font-mono-display text-[#93b0b4]">
        {hint ?? "—"}
      </div>
    </div>
  );
}
