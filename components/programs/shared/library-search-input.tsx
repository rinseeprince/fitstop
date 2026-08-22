"use client"

import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens"

/**
 * THE toolbar search field (36px tier), paired with <LibrarySortSelect>.
 *
 * Every visual property is spelled out here rather than inherited, because the
 * `Input` primitive is still un-migrated shadcn: it ships `rounded-md` (8px
 * against the mandated 6px), `border-border` and `bg-transparent` off the OKLCH
 * layer, `text-sm`, and a 1px/20% focus ring instead of the shared one. Until
 * that primitive is migrated, a toolbar search that inherits is a toolbar
 * search that is wrong in five ways.
 */
export function LibrarySearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#93b0b4]"
        strokeWidth={1.5}
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-9 w-[260px] rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white py-0 pl-9 pr-2.5",
          "text-[13px] text-[#0c1a1e] placeholder:text-[#93b0b4]",
          // The base's focus pair would otherwise win on the border.
          "focus:border-[rgba(13,148,136,0.08)] focus:ring-0",
          FOCUS_RING,
        )}
      />
    </div>
  )
}
