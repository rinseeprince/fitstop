"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
/**
 * THE toolbar sort control (36px tier), the right-hand half of the pair
 * <LibrarySearchInput> opens. The `Select` primitive is now Teal-Summit in
 * full — trigger and panel — so this only sets the 36px toolbar tier's own
 * geometry and the secondary ink a sort label reads in.
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
        // Only the toolbar tier's own specifics: the primitive now owns the
        // radius, border, fill, focus ring and chevron.
        className="h-9 w-[180px] px-2.5 py-0 font-normal text-[#5a7d82]"
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
