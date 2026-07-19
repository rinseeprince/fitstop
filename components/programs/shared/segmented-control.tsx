"use client"

import { cn } from "@/lib/utils"

// Hand-rolled segmented pill control — the established pattern from
// training-plan-builder.tsx (no ui/ primitive exists for this).
export function SegmentedControl({
  options,
  value,
  onChange,
  fullWidth = false,
}: {
  // disabled/title are optional per-option: a disabled segment stays visible
  // (with its title explaining why) but can't be selected.
  options: Array<{ value: string; label: string; disabled?: boolean; title?: string }>
  value: string
  onChange: (value: string) => void
  // Stretch to fill the container with equal-width segments (the builder
  // library panel's Sessions|Exercises switch).
  fullWidth?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-[6px] bg-[rgba(13,148,136,0.05)] p-[2px] gap-[2px]",
        fullWidth ? "flex" : "inline-flex",
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-3.5 py-1.5 rounded-[4px] text-[13px] transition-all duration-150",
              fullWidth && "flex-1",
              isActive
                ? "bg-white font-semibold text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "font-medium text-[#5a7d82] hover:text-[#0c1a1e]",
              option.disabled && "cursor-not-allowed opacity-50 hover:text-[#5a7d82]",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
