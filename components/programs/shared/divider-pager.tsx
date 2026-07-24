"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO_META_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

type DividerPagerProps = {
  page: number;
  total: number;
  pageSize: number;
  noun: string;
  onPageChange: (page: number) => void;
};

// "Showing X of Y {noun}" + prev/next chevrons for a SectionLabel's actions
// slot — LibraryTableShell's footer copy at divider scale, in the calendar
// toolbars' rail icon idiom. Renders nothing until data exists (total 0 =
// first load or true empty — the table body owns the empty message); a
// single-page dataset renders with both chevrons disabled so the cluster
// doesn't pop in and out as a dataset crosses the page-size threshold.
export function DividerPager({
  page,
  total,
  pageSize,
  noun,
  onPageChange,
}: DividerPagerProps) {
  if (total === 0) return null;

  const pageCount = Math.ceil(total / pageSize);
  const shown = Math.max(0, Math.min(pageSize, total - page * pageSize));

  const pagerButton = (dir: "prev" | "next", disabled: boolean) => (
    <button
      type="button"
      aria-label={dir === "prev" ? "Previous page" : "Next page"}
      disabled={disabled}
      onClick={() => onPageChange(dir === "prev" ? page - 1 : page + 1)}
      className={cn(
        "rounded p-1 transition-colors",
        disabled
          ? "cursor-default text-[#d5e0dd]"
          : "text-[#93b0b4] hover:text-[#0d9488]"
      )}
    >
      {dir === "prev" ? (
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <span className={cn("mr-1 whitespace-nowrap text-[11px]", MONO_META_CLASS)}>
        Showing {shown} of {total} {noun}
      </span>
      {pagerButton("prev", page <= 0)}
      {pagerButton("next", page >= pageCount - 1)}
    </div>
  );
}
