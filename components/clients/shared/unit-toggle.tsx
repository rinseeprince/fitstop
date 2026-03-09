"use client";

import { cn } from "@/lib/utils";
import type { UnitPreference } from "@/types/check-in";

type UnitToggleProps = {
  value: UnitPreference;
  onChange: (value: UnitPreference) => void;
  disabled?: boolean;
};

export function UnitToggle({ value, onChange, disabled }: UnitToggleProps) {
  return (
    <div className="bg-muted p-1 rounded-lg flex">
      <button
        type="button"
        onClick={() => onChange("metric")}
        disabled={disabled}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150",
          value === "metric"
            ? "bg-card text-foreground"
            : "text-muted-foreground"
        )}
      >
        Metric (kg)
      </button>
      <button
        type="button"
        onClick={() => onChange("imperial")}
        disabled={disabled}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150",
          value === "imperial"
            ? "bg-card text-foreground"
            : "text-muted-foreground"
        )}
      >
        Imperial (lbs)
      </button>
    </div>
  );
}
