"use client";

import { cn } from "@/lib/utils";
import type { UnitPreference } from "@/types/check-in";

type UnitToggleProps = {
  value: UnitPreference;
  onChange: (value: UnitPreference) => void;
  disabled?: boolean;
  /** "sm" = compact kg/lbs control for the dark drawer header. */
  size?: "default" | "sm";
};

export function UnitToggle({ value, onChange, disabled, size = "default" }: UnitToggleProps) {
  const sm = size === "sm";
  const trackClass = sm ? "bg-[rgba(255,255,255,0.06)]" : "bg-[rgba(13,148,136,0.05)]";

  const buttonClass = (active: boolean) =>
    cn(
      "flex items-center justify-center gap-2 rounded-[4px] transition-all duration-150",
      sm ? "px-2.5 py-1 text-[11px]" : "flex-1 px-4 py-2 text-[13px]",
      active
        ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] font-semibold text-[#0c1a1e]"
        : sm
          ? "bg-transparent font-medium text-[rgba(255,255,255,0.55)]"
          : "bg-transparent font-normal text-[#5a7d82]"
    );

  return (
    <div className={cn("rounded-[6px] p-[2px] flex", trackClass)}>
      <button
        type="button"
        onClick={() => onChange("metric")}
        disabled={disabled}
        className={buttonClass(value === "metric")}
      >
        {sm ? "kg" : "Metric (kg)"}
      </button>
      <button
        type="button"
        onClick={() => onChange("imperial")}
        disabled={disabled}
        className={buttonClass(value === "imperial")}
      >
        {sm ? "lbs" : "Imperial (lbs)"}
      </button>
    </div>
  );
}
