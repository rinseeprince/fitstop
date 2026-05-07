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
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export type ColumnDef<TRow = Record<string, unknown>> = {
  key: string;
  label: string;
  render: (value: unknown, row: TRow) => ReactNode;
  chartType?: "line" | "bar" | "heatmap";
};

type HistoryTableProps<TRow = Record<string, unknown>> = {
  columns: ColumnDef<TRow>[];
  data: TRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  isLoading: boolean;
  emptyMessage?: string;
  onColumnClick?: (columnKey: string) => void;
  onRowClick?: (row: TRow) => void;
  isRowClickable?: (row: TRow) => boolean;
};

export function HistoryTable<TRow extends Record<string, unknown>>({
  columns,
  data,
  total,
  page,
  onPageChange,
  isLoading,
  emptyMessage = "No data available",
  onColumnClick,
  onRowClick,
  isRowClickable,
}: HistoryTableProps<TRow>) {
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>
                {col.chartType && onColumnClick ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
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
            Array.from({ length: PAGE_SIZE }).map((_, rowIdx) => (
              <TableRow key={`skeleton-${rowIdx}`}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
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
                  className={clickable ? "cursor-pointer hover:bg-muted/50" : undefined}
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

      {totalPages > 1 && !isLoading && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            className={cn("gap-1", page === 0 && "pointer-events-none opacity-50")}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => onPageChange(page + 1)}
            className={cn(
              "gap-1",
              page >= totalPages - 1 && "pointer-events-none opacity-50"
            )}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
