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
    <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] flex">
      <button
        type="button"
        onClick={() => onChange("metric")}
        disabled={disabled}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-[13px] rounded-[4px] transition-all duration-150",
          value === "metric"
            ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] font-semibold text-[#0c1a1e]"
            : "bg-transparent font-normal text-[#5a7d82]"
        )}
      >
        Metric (kg)
      </button>
      <button
        type="button"
        onClick={() => onChange("imperial")}
        disabled={disabled}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-[13px] rounded-[4px] transition-all duration-150",
          value === "imperial"
            ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] font-semibold text-[#0c1a1e]"
            : "bg-transparent font-normal text-[#5a7d82]"
        )}
      >
        Imperial (lbs)
      </button>
    </div>
  );
}
