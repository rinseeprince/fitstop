"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens"

/**
 * THE toolbar sort control (36px tier), the right-hand half of the pair
 * <LibrarySearchInput> opens. Same reason for spelling every property out: the
 * `SelectTrigger` primitive is un-migrated shadcn (`rounded-md`, `border-border`,
 * `bg-transparent`, `text-sm`, a 1px/20% focus ring and a 16px chevron in
 * `muted-foreground`), so an inherited trigger does not match the field beside it.
 *
 * The value is a control option, not a data string, so it stays sans — and it
 * is sentence case, like every other value-picker trigger in the system.
 */
export function LibrarySortSelect({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-9 w-[180px] rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white px-2.5 py-0",
          "text-[13px] font-normal text-[#5a7d82]",
          "focus:border-[rgba(13,148,136,0.08)] focus:ring-0",
          // The primitive's own chevron: 16px in an OKLCH grey by default.
          "[&_svg]:size-3.5 [&_svg]:text-[#93b0b4]",
          FOCUS_RING,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
