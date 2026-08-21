"use client"

import { cn } from "@/lib/utils"

// THE segmented pill control. There is no ui/ primitive for this shape, so
// this component is the single definition of it — never hand-roll another
// (docs/newdesignsystem.md → Segmented control; enforced by check:labels
// clause 3). Five hand-rolled copies had drifted to five different sizes and
// two different active weights before they were consolidated here.
//
// The active segment is carried by the WHITE PILL, the shadow and the darker
// ink — NOT by a heavier font (owner decision, 2026-08-21). Weight is constant
// across states so the control does not visibly reflow as the selection moves,
// and so a pane switcher never out-shouts the content under it.
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
              "px-4 py-1.5 rounded-[4px] text-[12.5px] font-medium transition-all duration-150",
              fullWidth && "flex-1",
              isActive
                ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "text-[#5a7d82] hover:text-[#0c1a1e]",
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
