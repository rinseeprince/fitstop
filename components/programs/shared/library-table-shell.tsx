"use client"

import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Table } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export const LIBRARY_PAGE_SIZE = 25

// White table card + footer ("Showing X of Y {noun}" + chevron pager) for
// the library pages. Owns nothing about rows — pages compose their own
// TableHeader/TableBody so cells stay bespoke. `shown` counts the FILTERED
// set (mockup semantics), the pager flips 25-row pages of it.
export function LibraryTableShell({
  shown,
  total,
  noun,
  page,
  pageCount,
  onPageChange,
  children,
}: {
  shown: number
  total: number
  noun: string
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  children: ReactNode
}) {
  const pagerButton = (dir: "prev" | "next", disabled: boolean) => (
    <button
      type="button"
      aria-label={dir === "prev" ? "Previous page" : "Next page"}
      disabled={disabled}
      onClick={() => onPageChange(dir === "prev" ? page - 1 : page + 1)}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors",
        disabled
          ? "cursor-default text-[#d5e0dd]"
          : "text-[#93b0b4] hover:bg-[#f0f5f4] hover:text-[#5a7d82]",
      )}
    >
      {dir === "prev" ? (
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
      ) : (
        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
      )}
    </button>
  )

  return (
    <div className="overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white">
      <Table>{children}</Table>
      <div className="flex items-center justify-between border-t border-[rgba(13,148,136,0.06)] px-5 py-2.5">
        <span className="font-mono-display text-[11px] text-[#93b0b4]">
          Showing {shown} of {total} {noun}
        </span>
        <div className="flex gap-1">
          {pagerButton("prev", page <= 0)}
          {pagerButton("next", page >= pageCount - 1)}
        </div>
      </div>
    </div>
  )
}
