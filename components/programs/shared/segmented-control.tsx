"use client"

import { cn } from "@/lib/utils"

// Hand-rolled segmented pill control — the established pattern from
// training-plan-builder.tsx (no ui/ primitive exists for this).
export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex rounded-[6px] bg-[rgba(13,148,136,0.05)] p-[2px] gap-[2px]">
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "px-3.5 py-1.5 rounded-[4px] text-[13px] transition-all duration-150",
              isActive
                ? "bg-white font-semibold text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "font-medium text-[#5a7d82] hover:text-[#0c1a1e]",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
