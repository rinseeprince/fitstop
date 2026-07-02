"use client"

import { cn } from "@/lib/utils"

// Row of toggle filter chips ("All" + derived values). 6px radius, not
// pills — the design system forbids pill shapes.
export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string // "all" sentinel or one of options
  onChange: (value: string) => void
}) {
  const all = ["all", ...options]
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((option) => {
        const isActive = value === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "h-8 rounded-[6px] px-3 text-[12.5px] capitalize transition-colors duration-150",
              isActive
                ? "bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
                : "border border-[rgba(13,148,136,0.08)] bg-white font-medium text-[#5a7d82] hover:text-[#0c1a1e]",
            )}
          >
            {option === "all" ? "All" : option}
          </button>
        )
      })}
    </div>
  )
}
