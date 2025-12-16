"use client";

import { Label } from "@/components/ui/label";
import type { UnitPreference } from "@/types/check-in";

type UnitToggleProps = {
  value: UnitPreference;
  onChange: (value: UnitPreference) => void;
  disabled?: boolean;
};

export function UnitToggle({ value, onChange, disabled }: UnitToggleProps) {
  return (
    <div className="flex items-center gap-3">
      <Label className="text-sm font-medium">Units:</Label>
      <div className="flex items-center gap-1 bg-secondary rounded-xs p-1">
        <button
          type="button"
          onClick={() => onChange("metric")}
          disabled={disabled}
          className={`px-3 py-1 text-sm font-medium rounded-xs transition-colors ${
            value === "metric"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Metric (kg)
        </button>
        <button
          type="button"
          onClick={() => onChange("imperial")}
          disabled={disabled}
          className={`px-3 py-1 text-sm font-medium rounded-xs transition-colors ${
            value === "imperial"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Imperial (lbs)
        </button>
      </div>
    </div>
  );
}
