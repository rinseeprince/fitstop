"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

/**
 * A heading that sorts its table — the Sessions table's and the All exercises
 * table's (docs/newdesignsystem.md → "Sessions table (readout)"): the heading's
 * own words as a button, the sorted one teal with an arrow (down = high to
 * low), its state in aria-sort, and in its title what a click does ("Lowest
 * e1RM first").
 */
export function SortHeading<C extends string>({
  column,
  sort,
  onSort,
  title,
  className,
  children,
}: {
  column: C;
  sort: { column: C; order: "asc" | "desc" };
  onSort: (column: C) => void;
  /** What a click on it sorts by, in words. */
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort.column === column;
  const Arrow = sort.order === "desc" ? ArrowDown : ArrowUp;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.order === "desc" ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        title={title}
        onClick={() => onSort(column)}
        className={cn(
          // The heading's own label type, which a button doesn't inherit
          LABEL_CLASS,
          "inline-flex items-center gap-1 rounded-[4px] transition-colors hover:text-[#0d9488]",
          active && "text-[#0d9488]",
          FOCUS_RING,
        )}
      >
        {children}
        {active && <Arrow className="h-3 w-3" strokeWidth={1.5} aria-hidden />}
      </button>
    </TableHead>
  );
}
