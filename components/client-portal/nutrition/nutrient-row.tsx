import type { LucideIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface NutrientRowProps {
  /** Unique field id, used to wire the label to the input and to key the bar in tests. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Tailwind text-color token for the icon, e.g. "text-primary" | "text-protein". */
  iconColorClass: string;
  /** Tailwind background-color token for the progress fill, e.g. "bg-primary" | "bg-protein". */
  barColorClass: string;
  /** Controlled input value (kept as a string so the field can be empty). */
  value: string;
  /** Resolved target for the day, or null when no plan/event sets one. */
  target: number | null;
  /** Display unit shown next to the target, e.g. "kcal" | "g". */
  unit: string;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * A single nutrient input (calories or a macro) with a vs-target progress bar.
 * Presentational only — the parent owns the value and the save flow. The shadcn
 * Progress primitive hardcodes a teal indicator, so the bar is a colored div to
 * carry the per-macro colour.
 */
export function NutrientRow({
  id,
  label,
  icon: Icon,
  iconColorClass,
  barColorClass,
  value,
  target,
  unit,
  min,
  max,
  disabled,
  onChange,
}: NutrientRowProps) {
  const parsed = value.trim() === "" ? NaN : Number(value);
  const consumed = Number.isFinite(parsed) ? parsed : 0;
  const pct = target ? Math.min(Math.round((consumed / target) * 100), 200) : 0;
  const barWidth = Math.min(pct, 100); // fill never overflows; the % label still shows >100

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={id}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Icon
            className={cn("h-4 w-4", iconColorClass)}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {label}
        </Label>
        {target !== null ? (
          <span className="font-mono-display text-xs text-muted-foreground">
            {consumed.toLocaleString()} / {target.toLocaleString()} {unit}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No target</span>
        )}
      </div>

      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step="1"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        className="font-mono-display"
      />

      {target !== null ? (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              data-testid={`${id}-bar`}
              className={cn("h-full rounded-full transition-all", barColorClass)}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <span className="font-mono-display w-10 shrink-0 text-right text-xs text-muted-foreground">
            {pct}%
          </span>
        </div>
      ) : null}
    </div>
  );
}
