"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Minus,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
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
  SOURCE_LABELS,
  TONE_TEXT,
} from "./metrics-format";
import type { FoldKind, LogRow, MetricSummary } from "./metrics-view-types";

/**
 * The three row actions of a physique reading (docs/MEASUREMENT-LOG-PLAN.md
 * D9): Edit on the day's standing reading, Remove on any live reading,
 * Restore on a removed one. A wellness entry has none. Hover-revealed, like
 * every other table's row actions.
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
  /** Newest-first rows for the CURRENT pane, every metric of it — one per day. */
  rows: LogRow[];
};

/**
 * What the table renders: a day's row, or — once the coach opens the day's
 * fold — one of the readings folded beneath it, carrying why it is not the
 * day's value. A folded reading is a full row, so the handlers take it as
 * they take any reading.
 */
type DisplayRow = LogRow & { foldKind?: FoldKind };

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

/** "Corrected · Check-in" / "Also logged · Client" — the Notes cell of a folded live reading. */
function renderFoldLabel(row: DisplayRow) {
  return (
    <span className="text-sm text-[#93b0b4]">
      {row.foldKind === "corrected" ? "Corrected" : "Also logged"}
      <span className="mx-1">·</span>
      {SOURCE_LABELS[row.source]}
    </span>
  );
}

/** The count that opens a day's fold — beside the value, a chevron for its state. */
function renderFoldToggle(row: LogRow, open: boolean, onToggle: (rowId: string) => void) {
  const count = row.folded.length;
  const Icon = open ? ChevronUp : ChevronDown;
  const noun = count === 1 ? "reading" : "readings";
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${count} more ${noun}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(row.id);
      }}
      className="ml-2 inline-flex items-center gap-0.5 rounded-[4px] px-1 text-[#5a7d82] transition-colors hover:bg-[#f0f5f4]"
    >
      <span className={cn(MONO, "text-[11px] tabular-nums")}>+{count}</span>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
    </button>
  );
}

function renderActions(row: DisplayRow, handlers: ReadingActionHandlers) {
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
  // A folded live reading can be removed, never edited: an edit belongs to
  // the reading in force, and a correction of a superseded one would only
  // produce another row under the same day.
  if (row.foldKind) {
    return (
      <RowActions
        actions={[
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

type ColumnContext = ReadingActionHandlers & {
  withActions: boolean;
  expanded: ReadonlySet<string>;
  onToggleFold: (rowId: string) => void;
};

// Columns are state-free apart from the actions cell and the fold toggle,
// which close over the handlers and the open set; the component builds them
// once per handler set and open set.
function buildColumns(ctx: ColumnContext): ColumnDef<DisplayRow>[] {
  const columns: ColumnDef<DisplayRow>[] = [
    {
      key: "date",
      label: "Date",
      render: (_v, row) =>
        row.foldKind ? null : (
          <span className={cn(MONO, "tabular-nums text-[#93b0b4]")}>
            {formatLogDate(row.date)}
          </span>
        ),
    },
    {
      key: "day",
      label: "Day",
      render: (_v, row) =>
        row.foldKind ? null : <span className="text-[#93b0b4]">{formatDayName(row.date)}</span>,
    },
    {
      key: "value",
      label: "Value",
      render: (_v, row) => (
        <span
          className={cn(MONO, "tabular-nums", row.foldKind ? "text-[#93b0b4]" : "text-[#0c1a1e]")}
        >
          {row.value}
          <span className="text-[10px] text-[#93b0b4] ml-1">{row.unit}</span>
          {!row.foldKind &&
            row.folded.length > 0 &&
            renderFoldToggle(row, ctx.expanded.has(row.id), ctx.onToggleFold)}
        </span>
      ),
    },
    {
      key: "change",
      label: "Change",
      render: (_v, row) => (row.foldKind ? renderDash() : renderChange(row.change)),
    },
    {
      key: "note",
      label: "Notes",
      render: (_v, row) => {
        if (row.voided) return renderRemoval(row.voided);
        if (row.foldKind) return renderFoldLabel(row);
        if (!row.note) return renderDash();
        const truncated =
          row.note.length > 50 ? row.note.slice(0, 50) + "…" : row.note;
        return <span className="text-sm text-[#93b0b4]">{truncated}</span>;
      },
    },
  ];
  if (ctx.withActions) {
    columns.push({
      key: "actions",
      label: "",
      render: (_v, row) => renderActions(row, ctx),
    });
  }
  return columns;
}

// A folded reading sits on a quieter ground; a removed reading is muted — it
// is in no figure and can be restored.
const rowClassName = (row: DisplayRow) =>
  cn(row.foldKind && "bg-[#f8fafa]", row.voided && "opacity-60") || undefined;

export function MeasurementLogSection({
  metric,
  rows,
  onEditReading,
  onRemoveReading,
  onRestoreReading,
  pendingRowId = null,
}: MeasurementLogSectionProps) {
  const [page, setPage] = useState(0);
  // The folds the coach has opened — a view of the list, local (CONVENTIONS
  // §7: not deep-linkable), reset with the page by the host's key.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFold = useCallback((rowId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

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

  // One table row per day; the readings folded beneath an opened day follow
  // it, each carrying why it is not the day's value. The page is cut on days,
  // so opening a fold never pushes a day off the page.
  const unfold = (dayRows: LogRow[]): DisplayRow[] =>
    dayRows.flatMap((row) =>
      expanded.has(row.id)
        ? [row, ...row.folded.map((reading) => ({ ...reading, folded: [], foldKind: reading.kind }))]
        : [row]
    );

  // The actions column exists only where a row can carry an action — the
  // Wellness pane's entries have none, and an empty column there is noise.
  const withActions = rows.some((row) => row.isMeasurement);
  const columns = useMemo(
    () =>
      buildColumns({
        onEditReading,
        onRemoveReading,
        onRestoreReading,
        pendingRowId,
        withActions,
        expanded,
        onToggleFold: toggleFold,
      }),
    [onEditReading, onRemoveReading, onRestoreReading, pendingRowId, withActions, expanded, toggleFold]
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
        <HistoryTable<DisplayRow>
          columns={columns}
          data={unfold(pageRows)}
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
            <HistoryTable<DisplayRow>
              columns={columns}
              data={unfold(beforeStartRows)}
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
