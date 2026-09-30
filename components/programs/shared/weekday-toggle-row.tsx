"use client"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens"
import { SHORT_WEEKDAY } from "@/lib/date-helpers"
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers"
import type { DayOfWeek } from "@/types/check-in"

// THE weekday picker: seven toggles, Monday first, any number on at once
// (docs/newdesignsystem.md → Weekday toggle row). Each day is its own toggle —
// a button with `aria-pressed` — so the row picks a SET of days, which neither
// a segmented control (one of several) nor a switch (one on/off) can say. The
// look is the filter chip's, and like the segmented control's its weight never
// changes with its state: the teal wash carries the pick, never the weight.

export function WeekdayToggleRow({
  value,
  onChange,
  label,
  disabled = false,
}: {
  /** The days picked, in any order. */
  value: readonly DayOfWeek[]
  /** The days picked after a toggle, Monday first. */
  onChange: (days: DayOfWeek[]) => void
  /** Names the row for a screen reader ("Days"). */
  label: string
  disabled?: boolean
}) {
  const toggle = (day: DayOfWeek) => {
    const next = value.includes(day) ? value.filter((picked) => picked !== day) : [...value, day]
    onChange(DAYS_OF_WEEK.filter((candidate) => next.includes(candidate)))
  }

  return (
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1">
      {DAYS_OF_WEEK.map((day) => {
        const picked = value.includes(day)
        return (
          <button
            key={day}
            type="button"
            aria-pressed={picked}
            disabled={disabled}
            onClick={() => toggle(day)}
            className={cn(
              "h-8 rounded-[6px] border text-[12.5px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              FOCUS_RING,
              picked
                ? "border-transparent bg-[rgba(13,148,136,0.08)] text-[#0d9488]"
                : "border-[rgba(13,148,136,0.08)] bg-white text-[#5a7d82] hover:text-[#0c1a1e]",
            )}
          >
            {SHORT_WEEKDAY[day]}
          </button>
        )
      })}
    </div>
  )
}
