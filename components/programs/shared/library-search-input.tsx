"use client"

import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * THE search field. Both tiers of it, so there is one implementation rather
 * than one per surface:
 *
 * - `toolbar` (36px) — a section toolbar, paired with <LibrarySortSelect>.
 * - `panel` (32px) — a side panel, drawer or popover list filter.
 *
 * The `Input` primitive owns the border, radius, focus ring, ink and
 * placeholder; this only sets the tier's geometry and the icon that goes with
 * it. Never hand-roll a magnifier beside an input — that is what produced four
 * different focus treatments across the app.
 *
 * `fill` is the one visual thing a call site may choose, because it depends on
 * what the field is sitting ON rather than on what the field is: a toolbar
 * search reads white against the page, a drawer search reads recessed against
 * white. It is an enum, not a class, so "set the fill" cannot quietly become
 * "restyle the field".
 */
const TIER = {
  toolbar: {
    field: "h-9 w-[260px] py-0 pl-9 pr-2.5 text-[13px]",
    icon: "left-3 h-4 w-4",
    fill: "white",
  },
  panel: {
    field: "h-8 py-0 pl-8 pr-2.5 text-xs",
    icon: "left-2.5 h-3.5 w-3.5",
    fill: "transparent",
  },
} as const

const FILL = {
  transparent: "",
  white: "bg-white",
  page: "bg-[#f4f7f6]",
} as const

export function LibrarySearchInput({
  value,
  onChange,
  placeholder,
  size = "toolbar",
  fill,
  className,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  size?: keyof typeof TIER
  /** Defaults to the tier's own fill. */
  fill?: keyof typeof FILL
  /** Width overrides only — the treatment belongs to the tier. */
  className?: string
  "aria-label"?: string
}) {
  const tier = TIER[size]
  return (
    <div className={cn("relative", className)}>
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[#93b0b4]",
          tier.icon,
        )}
        strokeWidth={1.5}
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(tier.field, FILL[fill ?? tier.fill], className && "w-full")}
      />
    </div>
  )
}
