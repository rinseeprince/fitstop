"use client";

import type { ReactNode } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";

export type ColumnDef<TRow = Record<string, unknown>> = {
  key: string;
  label: string;
  render: (value: unknown, row: TRow) => ReactNode;
  chartType?: "line" | "bar" | "heatmap";
  /**
   * A Tailwind width class for this column (`w-[104px]`, `w-[22%]`).
   *
   * Declaring one on ANY column switches the whole table to a fixed layout, so
   * the columns stop taking their width from their widest cell: a long note on
   * one row no longer squashes the columns beside it, and they no longer move
   * when the page changes.
   *
   * **Declare one on EVERY column.** Space left over is shared out in
   * proportion to the declared widths, so a table that declares them all grows
   * evenly and fills its card; a column left undeclared instead absorbs the
   * WHOLE remainder and bunches the rest on the left. Give the column that
   * should yield first a percentage and the others their measured floor in px,
   * and the percentage one is the only one that narrows when the window does.
   *
   * The cost is the other half of the same rule: content wider than its column
   * OVERFLOWS instead of widening it, so a column holding text the coach wrote
   * clips it (`truncate`) rather than letting it spill.
   *
   * A table that declares none is untouched — it keeps the auto layout, which
   * is right for the tables whose every column is a short, bounded figure.
   */
  width?: string;
};

type HistoryTableProps<TRow = Record<string, unknown>> = {
  columns: ColumnDef<TRow>[];
  data: TRow[];
  isLoading: boolean;
  /** A settled failure. Renders its own row — the empty state is a statement
   *  about the data and must be unreachable from a failed read
   *  (docs/newdesignsystem.md → "Loading & async states"). */
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  onColumnClick?: (columnKey: string) => void;
  onRowClick?: (row: TRow) => void;
  isRowClickable?: (row: TRow) => boolean;
  /** Extra classes for one row — a muted state, never a layout change. */
  rowClassName?: (row: TRow) => string | undefined;
};

export function HistoryTable<TRow extends Record<string, unknown>>({
  columns,
  data,
  isLoading,
  isError = false,
  errorMessage = "Could not load this history",
  onRetry,
  emptyMessage = "No data available",
  onColumnClick,
  onRowClick,
  isRowClickable,
  rowClassName,
}: HistoryTableProps<TRow>) {
  // Fixed layout is opt-in, per table, by declaring a width (see `ColumnDef`).
  // In a fixed table the header row's widths govern every body row, which is
  // why the width rides on the heading and no cell repeats it.
  const hasDeclaredWidths = columns.some((col) => col.width);

  return (
    <Table className={cn(hasDeclaredWidths && "table-fixed")}>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={col.width}>
              {col.chartType && onColumnClick ? (
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-[#0d9488]"
                  onClick={() => onColumnClick(col.key)}
                >
                  {col.label}
                  <BarChart3 className="h-3.5 w-3.5" />
                </button>
              ) : (
                col.label
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: HISTORY_PAGE_SIZE }).map((_, rowIdx) => (
            <TableRow key={`skeleton-${rowIdx}`}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : isError ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center">
              <p className="text-[13px] text-[#5a7d82]">{errorMessage}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 text-[12.5px] font-medium text-[#0d9488] transition-colors hover:text-[#0a5c55]"
                >
                  Try again
                </button>
              )}
            </TableCell>
          </TableRow>
        ) : data.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="h-24 text-center text-[13px] text-[#93b0b4]"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row, rowIdx) => {
            const clickable = onRowClick && (!isRowClickable || isRowClickable(row));
            return (
              // `group/row` is what a hover-revealed RowActions cluster keys on.
              <TableRow
                key={rowIdx}
                className={cn("group/row", clickable && "cursor-pointer", rowClassName?.(row))}
                onClick={clickable ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    {col.render(row[col.key as keyof TRow], row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
