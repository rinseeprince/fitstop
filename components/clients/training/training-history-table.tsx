"use client";

import { useState, useMemo, useCallback } from "react";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { HistoryChartDialog } from "@/components/clients/history-table/history-chart-dialog";
import { useHistoryData, HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { SessionLogDetailDialog } from "@/components/clients/training/session-log-detail-dialog";
import { TrainingSummaryHero } from "@/components/clients/training/training-summary-hero";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { DividerPager } from "@/components/programs/shared/divider-pager";
import { cn } from "@/lib/utils";
import {
  CHIP_NEUTRAL_CLASS,
  LABEL_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { ClientTab } from "@/lib/client-tabs";
import type { TrainingHistoryRow } from "@/types/history";

function formatDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDay(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { weekday: "long" });
}

function renderDash() {
  return <span className="text-[#93b0b4]">—</span>;
}

function renderStatus(row: TrainingHistoryRow) {
  // Unlogged rows: show "Not Logged" or "Rest"
  if (row.is_logged === false) {
    if (row.session_name) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#f0f4f4] text-[#93b0b4]">
          Not Logged
        </span>
      );
    }
    return (
      <span className="text-xs text-[#b8cfd3]">Rest</span>
    );
  }

  switch (row.completion_quality) {
    case "full":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[rgba(13,148,136,0.08)] text-[#0d9488]">
          Completed
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-amber-50 text-amber-600">
          Partial
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#e6edec] text-[#93b0b4]">
          Logged
        </span>
      );
  }
}

const QUALITY_VALUES: Record<string, number> = {
  full: 3,
  partial: 2,
};

type Props = {
  clientId: string;
  // Exercise Data lives on the Journey tab, so the drill-down is a TAB change,
  // and cross-tab navigation runs through the client page's handler — the one
  // builder of a tab URL (the carried single-owner params, the stripped
  // ?subtab=).
  onTabChange?: (
    tab: ClientTab,
    extraParams?: Record<string, string | null>
  ) => void;
};

export function TrainingHistoryTable({ clientId, onTabChange }: Props) {
  const [page, setPage] = useState(0);
  // Each subject outlives its close: Radix re-renders a closing card from live
  // state (CONVENTIONS §7 → "No frame disagrees").
  const chart = useDialogSubject<string>();
  const sessionLog = useDialogSubject<string>();
  const showSessionLog = sessionLog.show;

  // No close beside the tab change: it unmounts this tab, dialog included (§7 rule 2).
  const handleExerciseDrillDown = useCallback(
    (exerciseId: string | null, exerciseName: string) => {
      // exerciseId is null for a freehand or unmatched log, and the destination
      // prefers the id over the name — so a previous drill-down's id has to be
      // CLEARED, not merely left unset, or it wins and shows the wrong exercise.
      onTabChange?.("metrics", {
        journey: "training",
        exerciseId: exerciseId ?? null,
        exerciseName,
      });
    },
    [onTabChange],
  );

  const { rows, total, isLoading, isError, mutate } = useHistoryData<TrainingHistoryRow>(
    `/api/clients/${clientId}/history/training`,
    page
  );
  const handleRowClick = useCallback(
    (row: TrainingHistoryRow) => {
      if (row.session_log_id) {
        showSessionLog(row.session_log_id);
      }
    },
    [showSessionLog],
  );

  const isRowClickable = useCallback(
    (row: TrainingHistoryRow) => !!row.session_log_id,
    [],
  );

  const chartData = useMemo(() => {
    if (!chart.subject || rows.length === 0) return [];
    return [...rows].reverse().map((row) => ({
      date: formatDate(row.date),
      value: row.completion_quality
        ? QUALITY_VALUES[row.completion_quality] ?? 0
        : 0,
    }));
  }, [chart.subject, rows]);

  const columns: ColumnDef<TrainingHistoryRow>[] = useMemo(
    () => [
      // EVERY column declares a width, and that is the point: in a fixed-layout
      // table the space left over is shared out in PROPORTION to the declared
      // widths, so the five grow together and the table fills its card. Leaving
      // Notes undeclared instead handed it the whole remainder — 615px of empty
      // column at a 1,131px table — and bunched the other four on the left.
      //
      // The four px values are floors measured in headless Chrome against the
      // real faces, read as BORDER boxes (Tailwind's preflight): "17 Sept" in
      // JetBrains Mono at 14px is 58.8px of the 84 inside a 100px column,
      // "Wednesday" in Instrument Sans medium 77.7 of 104, the longest seeded
      // session name beside an Alt chip 186.7 of 192, the "Not Logged" pill
      // 81.4 of 114. Notes is a PERCENTAGE so that it, and only it, gives the
      // space back when the window is too narrow for all five — the note is the
      // one thing here with no natural length.
      //
      // Measured at 1,400 / 1,131 / 950 / 860px of table: nothing bounded ever
      // clips, and the five stay in proportion at every one.
      {
        key: "date",
        label: "Date",
        width: "w-[100px]",
        render: (_v, row) => (
          <span className={cn(MONO, "tabular-nums", row.is_logged === false ? "text-[#b8cfd3]" : "text-[#93b0b4]")}>
            {formatDate(row.date)}
          </span>
        ),
      },
      {
        key: "day",
        label: "Day",
        width: "w-[120px]",
        render: (_v, row) => (
          <span className={row.is_logged === false ? "text-[#b8cfd3] font-medium" : "text-[#0c1a1e] font-medium"}>
            {formatDay(row.date)}
          </span>
        ),
      },
      {
        key: "session_name",
        label: "Session",
        width: "w-[208px]",
        render: (_v, row) =>
          row.session_name ? (
            // The name is the coach's own text, so it clips rather than
            // spilling into Status. `min-w-0` is what lets it: without it the
            // flex item refuses to shrink below its content and the Alt chip
            // is pushed out of the cell instead.
            <span
              className={`flex min-w-0 items-center gap-1.5 ${
                row.is_logged === false ? "text-[#b8cfd3]" : "text-[#0c1a1e]"
              }`}
            >
              <span className="truncate">{row.session_name}</span>
              {row.is_alternative && (
                <span
                  title="Client logged a different session than prescribed"
                  className={cn(LABEL_CLASS, CHIP_NEUTRAL_CLASS, "shrink-0 font-semibold")}
                >
                  Alt
                </span>
              )}
            </span>
          ) : (
            renderDash()
          ),
      },
      {
        key: "completion_quality",
        label: "Status",
        width: "w-[130px]",
        chartType: "bar" as const,
        render: (_v, row) => renderStatus(row),
      },
      {
        key: "notes",
        label: "Notes",
        width: "w-[34%]",
        render: (_v, row) => {
          if (!row.notes) return renderDash();
          // Clipped by the COLUMN, not at a character count: a count cannot
          // know how wide the column is. The whole note is one click away —
          // the row opens the workout, which quotes it under "Client Notes".
          return (
            <span className="block truncate text-sm text-[#93b0b4]">
              {row.notes}
            </span>
          );
        },
      },
    ],
    []
  );

  return (
    // Block flow, not flex-gap: the divider spec is 16px above (hero mb-4) and
    // 12px below (SectionLabel's own mb-3) — a flex gap would add to both.
    <div>
      <div className="mb-4">
        <TrainingSummaryHero clientId={clientId} />
      </div>

      {/* Section header: TRAINING LOG */}
      <SectionLabel
        label="Training Log"
        actions={
          <DividerPager
            page={page}
            total={total}
            pageSize={HISTORY_PAGE_SIZE}
            noun="sessions"
            onPageChange={setPage}
          />
        }
      />

      {/* Table card */}
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<TrainingHistoryRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          isError={Boolean(isError)}
          errorMessage="Could not load training history"
          onRetry={() => void mutate()}
          emptyMessage="No training sessions logged yet"
          onColumnClick={chart.show}
          onRowClick={handleRowClick}
          isRowClickable={isRowClickable}
        />
      </div>

      <SessionLogDetailDialog
        clientId={clientId}
        sessionLogId={sessionLog.subject}
        open={sessionLog.open}
        onOpenChange={(open) => {
          if (!open) sessionLog.close();
        }}
        onExerciseDrillDown={handleExerciseDrillDown}
      />

      <HistoryChartDialog
        open={chart.open}
        onClose={chart.close}
        title="Training Completion Quality"
        chartType="bar"
        data={chartData}
        dataKey="value"
        color="#0d9488"
      />
    </div>
  );
}
