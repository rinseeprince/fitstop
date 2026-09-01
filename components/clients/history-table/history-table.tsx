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
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";

export type ColumnDef<TRow = Record<string, unknown>> = {
  key: string;
  label: string;
  render: (value: unknown, row: TRow) => ReactNode;
  chartType?: "line" | "bar" | "heatmap";
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
}: HistoryTableProps<TRow>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key}>
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
              <TableRow
                key={rowIdx}
                className={clickable ? "cursor-pointer" : undefined}
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
