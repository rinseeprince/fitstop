"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  HistoryTable,
  type ColumnDef,
} from "@/components/clients/history-table/history-table";
import { HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { DividerPager } from "@/components/programs/shared/divider-pager";
import { RowActions } from "@/components/programs/shared/row-actions";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import {
  formatDayName,
  formatLogDate,
  formatShortDate,
  formatSigned,
  TONE_TEXT,
} from "./metrics-format";
import type { LogRow, MetricSummary } from "./metrics-view-types";

/**
 * The three row actions of a physique reading (docs/MEASUREMENT-LOG-PLAN.md
 * D9): Edit and Remove on a live row, Restore on a removed one. A wellness
 * entry has none. Hover-revealed, like every other table's row actions.
 */
type ReadingActionHandlers = {
  onEditReading?: (row: LogRow) => void;
  onRemoveReading?: (row: LogRow) => void;
  onRestoreReading?: (row: LogRow) => void;
  /** The row whose restore is in flight — the one action with no dialog to hold its spinner. */
  pendingRowId?: string | null;
};

type MeasurementLogSectionProps = ReadingActionHandlers & {
  /** The selected metric (the hero's switcher): the log is its readings, the
   *  pager counts them, and its name reads in the copy. The host remounts the
   *  section with key={metric.id}, so the page returns to 1 on every switch —
   *  of metric or of pane, since ids are unique across both. */
  metric: Pick<MetricSummary, "id" | "name">;
  /** Newest-first rows for the CURRENT pane, every metric of it. */
  rows: LogRow[];
};

function renderDash() {
  return <span className="text-[#93b0b4]">—</span>;
}

function renderChange(change: LogRow["change"]) {
  if (!change) return renderDash();
  const Icon = change.amount > 0 ? ArrowUp : change.amount < 0 ? ArrowDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5", TONE_TEXT[change.tone])}>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      <span className={cn(MONO, "text-[11px] tabular-nums")}>
        {formatSigned(change.amount)}
      </span>
    </span>
  );
}

/** "Removed by Sam · 3 Sep" — the Notes cell of a removed reading. */
function renderRemoval(voided: NonNullable<LogRow["voided"]>) {
  return (
    <span className="text-sm text-[#93b0b4]">
      {voided.byName ? `Removed by ${voided.byName}` : "Removed"}
      <span className="mx-1">·</span>
      <span className={cn(MONO, "text-[11px] tabular-nums")}>{formatShortDate(voided.at)}</span>
    </span>
  );
}

function renderActions(row: LogRow, handlers: ReadingActionHandlers) {
  if (!row.isMeasurement) return null;
  if (row.voided) {
    return (
      <RowActions
        actions={[
          {
            label: "Restore reading",
            icon: RotateCcw,
            onClick: () => handlers.onRestoreReading?.(row),
            disabled: handlers.pendingRowId === row.id,
          },
        ]}
      />
    );
  }
  // Destructive last, as on every rail.
  return (
    <RowActions
      actions={[
        { label: "Edit reading", icon: Pencil, onClick: () => handlers.onEditReading?.(row) },
        {
          label: "Remove reading",
          icon: Trash2,
          danger: true,
          onClick: () => handlers.onRemoveReading?.(row),
        },
      ]}
    />
  );
}

// Columns are state-free apart from the actions cell, which closes over the
// handlers; the component builds them once per handler set.
function buildColumns(handlers: ReadingActionHandlers, withActions: boolean): ColumnDef<LogRow>[] {
  const columns: ColumnDef<LogRow>[] = [
    {
      key: "date",
      label: "Date",
      render: (_v, row) => (
        <span className={cn(MONO, "tabular-nums text-[#93b0b4]")}>
          {formatLogDate(row.date)}
        </span>
      ),
    },
    {
      key: "day",
      label: "Day",
      render: (_v, row) => (
        <span className="text-[#93b0b4]">{formatDayName(row.date)}</span>
      ),
    },
    {
      key: "value",
      label: "Value",
      render: (_v, row) => (
        <span className={cn(MONO, "tabular-nums text-[#0c1a1e]")}>
          {row.value}
          <span className="text-[10px] text-[#93b0b4] ml-1">{row.unit}</span>
        </span>
      ),
    },
    {
      key: "change",
      label: "Change",
      render: (_v, row) => renderChange(row.change),
    },
    {
      key: "note",
      label: "Notes",
      render: (_v, row) => {
        if (row.voided) return renderRemoval(row.voided);
        if (!row.note) return renderDash();
        const truncated =
          row.note.length > 50 ? row.note.slice(0, 50) + "…" : row.note;
        return <span className="text-sm text-[#93b0b4]">{truncated}</span>;
      },
    },
  ];
  if (withActions) {
    columns.push({
      key: "actions",
      label: "",
      render: (_v, row) => renderActions(row, handlers),
    });
  }
  return columns;
}

// A removed reading is listed, muted: it is in no figure and can be restored.
const rowClassName = (row: LogRow) => (row.voided ? "opacity-60" : undefined);

export function MeasurementLogSection({
  metric,
  rows,
  onEditReading,
  onRemoveReading,
  onRestoreReading,
  pendingRowId = null,
}: MeasurementLogSectionProps) {
  const [page, setPage] = useState(0);
  // The log is the selected metric's (docs/MEASUREMENT-LOG-PLAN.md commit 6,
  // D13–D14): the pane's rows are already in memory, so the filter is one
  // predicate during render — the way the chart section filters its points by
  // range — and the pager's total follows it.
  const metricRows = rows.filter((row) => row.metricId === metric.id);
  // A reading dated before the client's start date is still theirs — it is
  // listed, under its own rail, and it is simply not part of the journey the
  // chart and the figures above describe. Few by nature, so unpaged.
  const journeyRows = metricRows.filter((row) => !row.beforeStart);
  const beforeStartRows = metricRows.filter((row) => row.beforeStart);
  const pageRows = journeyRows.slice(
    page * HISTORY_PAGE_SIZE,
    page * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE
  );

  // The actions column exists only where a row can carry an action — the
  // Wellness pane's entries have none, and an empty column there is noise.
  const withActions = rows.some((row) => row.isMeasurement);
  const columns = useMemo(
    () =>
      buildColumns(
        { onEditReading, onRemoveReading, onRestoreReading, pendingRowId },
        withActions
      ),
    [onEditReading, onRemoveReading, onRestoreReading, pendingRowId, withActions]
  );

  return (
    <div>
      <SectionLabel
        label="Measurement log"
        actions={
          <DividerPager
            page={page}
            total={journeyRows.length}
            pageSize={HISTORY_PAGE_SIZE}
            // D12: the metric is the pager's noun, so the count and the hero's
            // entries chip read as one phrase — "Showing 10 of 12 weight entries".
            noun={`${metric.name.toLowerCase()} entries`}
            onPageChange={setPage}
          />
        }
      />
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<LogRow>
          columns={columns}
          data={pageRows}
          isLoading={false}
          // D15: the chart section's sentence, whose call to action sits directly above.
          emptyMessage={`No ${metric.name} entries yet`}
          rowClassName={rowClassName}
        />
      </div>
      {beforeStartRows.length > 0 && (
        <div className="mt-6">
          <SectionLabel label="Before start" />
          <div className="bg-white rounded-[6px] p-5">
            <HistoryTable<LogRow>
              columns={columns}
              data={beforeStartRows}
              isLoading={false}
              emptyMessage="No readings before the start date"
              rowClassName={rowClassName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
