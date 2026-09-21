"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { DividerPager } from "@/components/programs/shared/divider-pager";
import { cn } from "@/lib/utils";
import {
  MONO_CELL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { useUnits } from "@/contexts/units-context";
import type { ExerciseBestsRow } from "@/types/training";
import {
  BESTS_COLUMNS,
  DEFAULT_BESTS_SORT,
  bestsColumnHeading,
  bestsSortLabel,
  formatBestsCell,
  nextBestsSort,
  sortBests,
  type BestsColumn,
  type BestsSort,
} from "@/utils/exercise-bests-table";
import { SessionsLoadError } from "./sessions-load-error";
import { SortHeading } from "./sort-heading";

// Every exercise the client has logged, one row each, with its bests — what
// the exercise picker's "All exercises" shows under the hero, in the coach's
// exercise data view and the client's Performance view alike
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4, commit 16b). The bests
// are the exercise's records summarised (utils/exercise-bests-table.ts), so a
// row never disagrees with its PR cards; a row opens that exercise.
//
// Its headings sort it the Sessions table's way, and it pages in memory, ten
// exercises a page, with the history tables' count — no session window above
// it says how many there are. The sort and the page are local, never the
// address: the table mounts only while All exercises is picked, so a return to
// it starts on its default sort, page 1.

type AllExercisesTableProps = {
  /** Every exercise's bests, most sessions first; undefined until the read lands. */
  rows: ExerciseBestsRow[] | undefined;
  /** The read failed with nothing in hand. */
  isError: boolean;
  onRetry: () => void;
  /** The coach's rail is a divider; the client's heads its section like Personal Records. */
  audience: "coach" | "client";
  /** Opens an exercise's own view, as picking it does. */
  onOpenExercise: (row: ExerciseBestsRow) => void;
};

// The Exercise column stays put while the bests scroll under it — the Sessions
// table's pinned Date cell, opaque, with the row hover's opaque twin.
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

/** An exercise's key: its catalog id, else its name — the way the exercise list tells them apart. */
const rowKey = (row: ExerciseBestsRow): string => row.exerciseId ?? `name:${row.name.toLowerCase()}`;

export function AllExercisesTable({ rows, isError, onRetry, audience, onOpenExercise }: AllExercisesTableProps) {
  const { preference } = useUnits();
  const [sort, setSort] = useState<BestsSort>(DEFAULT_BESTS_SORT);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => sortBests(rows ?? [], sort), [rows, sort]);

  // A refresh that shrank the list can't leave the page past its end
  const pageCount = Math.ceil(sorted.length / HISTORY_PAGE_SIZE);
  const shownPage = Math.min(page, Math.max(0, pageCount - 1));
  const pageRows = sorted.slice(shownPage * HISTORY_PAGE_SIZE, (shownPage + 1) * HISTORY_PAGE_SIZE);

  // One click, one render: the sort and the first page land together
  const handleSort = (column: BestsColumn) => {
    setSort(nextBestsSort(sort, column));
    setPage(0);
  };

  // The count and the arrows once there are rows; nothing while pending
  const pager = rows ? (
    <DividerPager
      page={shownPage}
      total={rows.length}
      pageSize={HISTORY_PAGE_SIZE}
      noun="exercises"
      onPageChange={setPage}
    />
  ) : null;

  return (
    <section aria-label="Exercises">
      {audience === "coach" ? (
        <SectionLabel label="Exercises" actions={pager} />
      ) : (
        // The client's Performance view heads its sections like Personal Records
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[#0c1a1e]">Exercises</h2>
          {pager}
        </div>
      )}
      <div className="rounded-[6px] bg-white p-5">
        {isError ? (
          <SessionsLoadError what="exercises" onRetry={onRetry} />
        ) : rows === undefined ? (
          <ExercisesSkeleton />
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[#93b0b4]">No exercises logged yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {BESTS_COLUMNS.map((column) => (
                  <SortHeading
                    key={column}
                    column={column}
                    sort={sort}
                    onSort={handleSort}
                    title={bestsSortLabel(nextBestsSort(sort, column))}
                    className={column === "exercise" ? PINNED_CELL : undefined}
                  >
                    {bestsColumnHeading(column, preference)}
                  </SortHeading>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  className="group/row cursor-pointer"
                  onClick={() => onOpenExercise(row)}
                >
                  {BESTS_COLUMNS.map((column) => {
                    const value = formatBestsCell(column, row, preference);
                    if (column === "exercise") {
                      return (
                        <TableCell key={column} className={cn(PINNED_CELL, PINNED_ROW_HOVER)}>
                          <span className={cn("text-[13px] font-medium", TEXT_PRIMARY)}>{value}</span>
                        </TableCell>
                      );
                    }
                    if (column === "type") {
                      return (
                        <TableCell key={column}>
                          <span className={cn("text-[12.5px]", TEXT_SECONDARY)}>{value}</span>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={column}>
                        {value ? (
                          <span
                            className={cn(
                              MONO_CELL_CLASS,
                              column === "last_logged" ? TEXT_SECONDARY : TEXT_PRIMARY,
                            )}
                          >
                            {value}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

/** The table's shape while the exercises load: a page of rows, nothing claimed about the bests. */
function ExercisesSkeleton() {
  return (
    <Table aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[180px]">
            <Skeleton className="h-3 w-16" />
          </TableHead>
          <TableHead>
            <Skeleton className="h-3 w-full" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: HISTORY_PAGE_SIZE }).map((_, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            <TableCell className="w-[180px]">
              <Skeleton className="h-4 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
