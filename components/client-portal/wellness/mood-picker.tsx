import { Frown, Heart, Meh, Smile, SmilePlus, type LucideIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The 1–5 mood scale, lifted from the (Session 5.1-retired) Daily Pulse wellness section. */
const MOODS: ReadonlyArray<{
  value: number;
  icon: LucideIcon;
  label: string;
  color: string;
}> = [
  { value: 1, icon: Frown, label: "Poor", color: "text-destructive" },
  { value: 2, icon: Meh, label: "Below Average", color: "text-warning" },
  { value: 3, icon: Smile, label: "Good", color: "text-warning" },
  { value: 4, icon: SmilePlus, label: "Great", color: "text-success" },
  { value: 5, icon: Heart, label: "Excellent", color: "text-success" },
];

export interface MoodPickerProps {
  /** Selected mood 1–5, or null when nothing is chosen yet. */
  value: number | null;
  disabled?: boolean;
  /** Fires with the tapped mood value (1–5). */
  onChange: (value: number) => void;
}

/**
 * Mood selector — five emoji buttons. Presentational only; the parent owns the value and
 * the save flow (mirrors components/client-portal/nutrition/nutrient-row.tsx). The button
 * label text is the accessible name; the icon is decorative.
 */
export function MoodPicker({ value, disabled, onChange }: MoodPickerProps) {
  return (
    <div className="space-y-3">
      <Label>Overall mood</Label>
      <div className="grid grid-cols-5 gap-2">
        {MOODS.map(({ value: moodValue, icon: Icon, label, color }) => {
          const selected = value === moodValue;
          return (
            <button
              key={moodValue}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(moodValue)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-all duration-200",
                selected ? "border-primary bg-primary/5" : "border-border",
                !disabled && "hover:scale-105",
                !disabled && !selected && "hover:border-primary/50",
                disabled && "opacity-60",
              )}
            >
              <Icon
                className={cn("h-5 w-5", selected ? color : "text-muted-foreground")}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="text-xs font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
