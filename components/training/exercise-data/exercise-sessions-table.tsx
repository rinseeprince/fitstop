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
import { RailDropdown } from "@/components/programs/shared/rail-dropdown";
import { cn } from "@/lib/utils";
import {
  MONO_CELL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { useUnits } from "@/contexts/units-context";
import type { ExerciseProgressionPoint } from "@/types/training";
import {
  DEFAULT_SESSION_SORT,
  effectiveSessionSort,
  formatSessionCell,
  formatSessionDate,
  sessionColumnHeading,
  sessionColumnsIn,
  sessionSortLabel,
  sessionSortOptions,
  sessionSortValue,
  sortSessions,
  type SessionColumn,
  type SessionSort,
} from "@/utils/exercise-session-columns";
import { SessionColumnsMenu } from "./session-columns-menu";
import { SessionsLoadError } from "./sessions-load-error";

// The table of an exercise's logged sessions beneath its chart — the coach's
// exercise data view and the client's Performance view alike
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4). It reads the
// progression points the chart reads, one row per session in the window, one
// column per measure they carry (utils/exercise-session-columns.ts), and pages
// them in memory: the chart already holds every session in the window.
//
// Its view — the columns ticked, the sort, the page — is local, never the
// address. The host keys the table by the exercise, so another exercise starts
// fresh; the window keys the page, so a new window starts on page 1 with its
// columns and sort kept; a lens switch touches none of it.

type ExerciseSessionsTableProps = {
  /** The window's sessions, oldest first — the chart's read; undefined until it lands. */
  points: ExerciseProgressionPoint[] | undefined;
  /** The read failed with nothing in hand. */
  isError: boolean;
  onRetry: () => void;
  /** The session window: a new one starts the table on its first page. */
  windowKey: string;
  /** The coach ticks columns on and off; the client sees every column recorded. */
  audience: "coach" | "client";
};

export function ExerciseSessionsTable({ windowKey, ...props }: ExerciseSessionsTableProps) {
  const [hidden, setHidden] = useState<ReadonlySet<SessionColumn>>(() => new Set());
  const [sort, setSort] = useState<SessionSort>(DEFAULT_SESSION_SORT);

  const toggleColumn = (column: SessionColumn) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });

  return (
    <SessionsPages
      key={windowKey}
      {...props}
      hidden={hidden}
      onToggleColumn={toggleColumn}
      sort={sort}
      onSortChange={setSort}
    />
  );
}

type SessionsPagesProps = Omit<ExerciseSessionsTableProps, "windowKey"> & {
  hidden: ReadonlySet<SessionColumn>;
  onToggleColumn: (column: SessionColumn) => void;
  sort: SessionSort;
  onSortChange: (sort: SessionSort) => void;
};

// The Date column stays put while the measures scroll under it — the logged
// workout table's pinned cell, opaque, with the row hover's opaque twin.
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

function SessionsPages({
  points,
  isError,
  onRetry,
  audience,
  hidden,
  onToggleColumn,
  sort,
  onSortChange,
}: SessionsPagesProps) {
  const { preference } = useUnits();
  const [page, setPage] = useState(0);

  const pending = points === undefined;
  const recorded = useMemo(() => sessionColumnsIn(points ?? []), [points]);
  const shown =
    audience === "coach" ? recorded.filter((column) => !hidden.has(column)) : recorded;
  const shownSort = effectiveSessionSort(sort, shown, pending);
  const rows = useMemo(() => sortSessions(points ?? [], shownSort), [points, shownSort]);
  const sortOptions = sessionSortOptions(shown);

  // A refresh that shrank the window can't leave the page past its end
  const lastPage = Math.max(0, Math.ceil(rows.length / HISTORY_PAGE_SIZE) - 1);
  const shownPage = Math.min(page, lastPage);
  const pageRows = rows.slice(shownPage * HISTORY_PAGE_SIZE, (shownPage + 1) * HISTORY_PAGE_SIZE);

  // One click, one render: the sort and the first page land together
  const handleSort = (value: string) => {
    const option = sortOptions.find((o) => o.value === value);
    if (!option) return;
    onSortChange(option.sort);
    setPage(0);
  };

  const controls = (
    <div className="flex items-center gap-3">
      {audience === "coach" && (
        <SessionColumnsMenu
          columns={recorded}
          hidden={hidden}
          onToggle={onToggleColumn}
          disabled={!pending && recorded.length === 0}
        />
      )}
      <RailDropdown
        label={sessionSortLabel(shownSort)}
        options={sortOptions}
        value={sessionSortValue(shownSort)}
        onChange={handleSort}
        pairs
      />
      <DividerPager
        page={shownPage}
        total={rows.length}
        pageSize={HISTORY_PAGE_SIZE}
        noun="sessions"
        onPageChange={setPage}
      />
    </div>
  );

  return (
    <section aria-label="Sessions">
      {audience === "coach" ? (
        <SectionLabel label="Sessions" actions={controls} />
      ) : (
        // The client's Performance view heads its sections like Personal Records
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[#0c1a1e]">Sessions</h2>
          {controls}
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
                <TableHead className={PINNED_CELL}>Date</TableHead>
                {shown.map((column) => (
                  <TableHead key={column}>{sessionColumnHeading(column, preference)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((point) => (
                <TableRow key={point.sessionLogId} className="group/row">
                  <TableCell className={cn(PINNED_CELL, PINNED_ROW_HOVER)}>
                    <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY)}>
                      {formatSessionDate(point.date)}
                    </span>
                  </TableCell>
                  {shown.map((column) => {
                    const cell = formatSessionCell(column, point, preference);
                    return (
                      <TableCell key={column}>
                        {cell ? (
                          <span className={cn(MONO_CELL_CLASS, TEXT_PRIMARY)}>
                            {cell.value}
                            {cell.aside && (
                              <span className="ml-1.5 text-[11px] text-[#93b0b4]">{cell.aside}</span>
                            )}
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

/** The table's shape while its sessions load: a page of rows, nothing claimed about the columns. */
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
