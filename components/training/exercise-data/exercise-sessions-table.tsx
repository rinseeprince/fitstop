"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
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
import { PagerArrows } from "@/components/programs/shared/divider-pager";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO_CELL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { useUnits } from "@/contexts/units-context";
import type { ExercisePR, ExerciseProgressionPoint } from "@/types/training";
import type { ExerciseType } from "@/utils/exercise-types";
import { recordLine, recordsHeldBy } from "@/utils/exercise-records";
import {
  DEFAULT_SESSION_SORT,
  EXERCISE_TYPE_FIGURES,
  formatSessionDate,
  formatSessionFigure,
  formatSessionSets,
  nextSessionSort,
  sessionFigureHeading,
  sessionSetsHeading,
  sessionSortLabel,
  sortSessions,
  type SessionFigure,
  type SessionSort,
} from "@/utils/exercise-session-figures";
import { SessionsLoadError } from "./sessions-load-error";

// The table of an exercise's logged sessions beneath its chart — the coach's
// exercise data view and the client's Performance view alike
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4). A row is a whole
// session, read the way a coach reads one: the working sets in shorthand, the
// type's figures, a star on a session holding a record; a click opens that
// workout
// (utils/exercise-session-figures.ts). It reads the progression points the
// chart reads and the PR cards' records, and pages in memory: the chart already
// holds every session in the window.
//
// Its rail pages with the arrows alone: the session window on the rail above
// already says how many sessions there are. Its headings sort it — a click
// sorts by the figure the way it leads, a second click the other way (owner,
// 2026-09-21); one sort, its ties newest first.
//
// Its sort and page are local, never the address. The host keys the table by
// the exercise, so another exercise starts fresh; the window keys the page, so
// a new window starts on page 1 with its sort kept; a lens switch touches none
// of it.

type ExerciseSessionsTableProps = {
  /** The window's sessions, oldest first — the chart's read; undefined until it lands. */
  points: ExerciseProgressionPoint[] | undefined;
  /** The exercise's type, which picks the figures; undefined until the exercise list lands. */
  exerciseType: ExerciseType | undefined;
  /** The exercise's records — the PR cards' read; a failed read leaves the rows without stars. */
  records: ExercisePR[] | undefined;
  recordsLoading: boolean;
  /** The read failed with nothing in hand. */
  isError: boolean;
  onRetry: () => void;
  /** The session window: a new one starts the table on its first page. */
  windowKey: string;
  /** The coach's rail is a divider; the client's heads its section like Personal Records. */
  audience: "coach" | "client";
  /** Opens a session's workout, for the rows that have one. */
  onOpenSession: (point: ExerciseProgressionPoint) => void;
  canOpenSession: (point: ExerciseProgressionPoint) => boolean;
};

export function ExerciseSessionsTable({ windowKey, ...props }: ExerciseSessionsTableProps) {
  const [sort, setSort] = useState<SessionSort>(DEFAULT_SESSION_SORT);
  return <SessionsPages key={windowKey} {...props} sort={sort} onSortChange={setSort} />;
}

type SessionsPagesProps = Omit<ExerciseSessionsTableProps, "windowKey"> & {
  sort: SessionSort;
  onSortChange: (sort: SessionSort) => void;
};

// The Date column stays put while the figures scroll under it — the logged
// workout table's pinned cell, opaque, with the row hover's opaque twin.
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

function SessionsPages({
  points,
  exerciseType,
  records,
  recordsLoading,
  isError,
  onRetry,
  audience,
  onOpenSession,
  canOpenSession,
  sort,
  onSortChange,
}: SessionsPagesProps) {
  const { preference } = useUnits();
  const [page, setPage] = useState(0);

  // Nothing claimed until the sessions, the type that picks the figures and
  // the records behind the stars have all landed: one frame, the whole row
  const pending = points === undefined || exerciseType === undefined || recordsLoading;
  const figures: readonly SessionFigure[] = exerciseType ? EXERCISE_TYPE_FIGURES[exerciseType] : [];
  const rows = useMemo(() => sortSessions(points ?? [], sort), [points, sort]);

  // A refresh that shrank the window can't leave the page past its end
  const pageCount = Math.ceil(rows.length / HISTORY_PAGE_SIZE);
  const shownPage = Math.min(page, Math.max(0, pageCount - 1));
  const pageRows = rows.slice(shownPage * HISTORY_PAGE_SIZE, (shownPage + 1) * HISTORY_PAGE_SIZE);

  // One click, one render: the sort and the first page land together
  const handleSort = (column: "date" | SessionFigure) => {
    onSortChange(nextSessionSort(sort, column));
    setPage(0);
  };

  const pager =
    !pending && rows.length > 0 ? (
      <PagerArrows page={shownPage} pageCount={pageCount} onPageChange={setPage} />
    ) : null;

  return (
    <section aria-label="Sessions">
      {audience === "coach" ? (
        <SectionLabel label="Sessions" actions={pager} />
      ) : (
        // The client's Performance view heads its sections like Personal Records
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[#0c1a1e]">Sessions</h2>
          {pager}
        </div>
      )}
      <div className="rounded-[6px] bg-white p-5">
        {isError ? (
          <SessionsLoadError onRetry={onRetry} />
        ) : pending ? (
          <SessionsSkeleton />
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[#93b0b4]">No sessions logged yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHeading column="date" sort={sort} onSort={handleSort} className={PINNED_CELL}>
                  Date
                </SortHeading>
                <TableHead>{sessionSetsHeading(points ?? [], preference)}</TableHead>
                {figures.map((figure) => (
                  <SortHeading key={figure} column={figure} sort={sort} onSort={handleSort}>
                    {sessionFigureHeading(figure, preference)}
                  </SortHeading>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((point) => {
                const opens = canOpenSession(point);
                const held = records ? recordsHeldBy(point, records) : [];
                const shorthand = formatSessionSets(point.sets, preference);
                return (
                  <TableRow
                    key={point.sessionLogId}
                    className={cn("group/row", opens && "cursor-pointer")}
                    onClick={opens ? () => onOpenSession(point) : undefined}
                  >
                    <TableCell className={cn(PINNED_CELL, PINNED_ROW_HOVER)}>
                      <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY)}>
                        {formatSessionDate(point.date)}
                      </span>
                      {held.length > 0 && (
                        <span
                          role="img"
                          aria-label={`Personal record: ${held.map((record) => recordLine(record, preference)).join(", ")}`}
                          title={held.map((record) => recordLine(record, preference)).join("\n")}
                          className="ml-1.5 text-[12px] text-[#d97706]"
                        >
                          ★
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[200px] whitespace-normal">
                      {shorthand ? (
                        <span className={cn(MONO_CELL_CLASS, TEXT_PRIMARY)}>{shorthand}</span>
                      ) : (
                        <Dash />
                      )}
                    </TableCell>
                    {figures.map((figure) => {
                      const value = formatSessionFigure(figure, point, preference);
                      return (
                        <TableCell key={figure}>
                          {value ? (
                            <span className={cn(MONO_CELL_CLASS, TEXT_PRIMARY)}>{value}</span>
                          ) : (
                            <Dash />
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

/**
 * A heading that sorts the table: the heading's own words as a button, the
 * sorted one teal with an arrow (down = high to low), its state in aria-sort,
 * and in its title what a click does ("Lowest e1RM first").
 */
function SortHeading({
  column,
  sort,
  onSort,
  className,
  children,
}: {
  column: "date" | SessionFigure;
  sort: SessionSort;
  onSort: (column: "date" | SessionFigure) => void;
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
        title={sessionSortLabel(nextSessionSort(sort, column))}
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

/** The table's shape while its sessions load: a page of rows, nothing claimed about the figures. */
function SessionsSkeleton() {
  return (
    <Table aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[132px]">
            <Skeleton className="h-3 w-12" />
          </TableHead>
          <TableHead>
            <Skeleton className="h-3 w-full" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: HISTORY_PAGE_SIZE }).map((_, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            <TableCell className="w-[132px]">
              <Skeleton className="h-4 w-24" />
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
