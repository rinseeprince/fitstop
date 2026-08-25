import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface WellnessScaleProps {
  /** Stable id wiring the label to the slider; also keys the field. */
  id: string;
  /** Visible label, e.g. "Energy level". Also the slider's accessible name. */
  label: string;
  /** Value to display; the parent supplies the default (e.g. `value ?? 5`). */
  value: number;
  disabled?: boolean;
  /** Fires on user interaction with the new value. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

/**
 * Labeled 1–max slider with an "n/max" readout. Presentational only — the parent owns the
 * value and decides "touched" (this component never defaults the value itself).
 */
export function WellnessScale({
  id,
  label,
  value,
  disabled,
  onChange,
  min = 1,
  max = 10,
}: WellnessScaleProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="font-mono-display text-sm font-semibold text-primary">
          {`${value}/${max}`}
        </span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        className="w-full"
      />
    </div>
  );
}
