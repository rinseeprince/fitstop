"use client";

import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { HistoryChartDialog } from "@/components/clients/history-table/history-chart-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { useHistoryData } from "@/hooks/use-history-data";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { TrainingHistoryRow, TrainingWeekSummary } from "@/types/history";

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
    case "skipped":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[rgba(192,96,96,0.08)] text-[#c06060]">
          Missed
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
  skipped: 1,
};

type Props = {
  clientId: string;
};

export function TrainingHistoryTable({ clientId }: Props) {
  const builder = useTrainingBuilderContext();
  const { plan } = builder;
  const [page, setPage] = useState(0);
  const [chartColumn, setChartColumn] = useState<string | null>(null);

  const { rows, total, isLoading } = useHistoryData<TrainingHistoryRow>(
    `/api/clients/${clientId}/history/training`,
    page
  );
  const handleColumnClick = useCallback((key: string) => {
    setChartColumn(key);
  }, []);

  // Week-scoped summary from dedicated endpoint
  const { data: summaryResponse, isLoading: summaryLoading } = useSWR<{ success: boolean; data: TrainingWeekSummary }>(
    `/api/clients/${clientId}/history/training/summary`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );
  const summary = summaryResponse?.data;
  const adherencePct = summary && summary.plannedUpToToday > 0
    ? Math.round((summary.completed / summary.plannedUpToToday) * 100)
    : 0;

  const chartData = useMemo(() => {
    if (!chartColumn || rows.length === 0) return [];
    return [...rows].reverse().map((row) => ({
      date: formatDate(row.date),
      value: row.completion_quality
        ? QUALITY_VALUES[row.completion_quality] ?? 0
        : 0,
    }));
  }, [chartColumn, rows]);

  const columns: ColumnDef<TrainingHistoryRow>[] = useMemo(
    () => [
      {
        key: "date",
        label: "Date",
        render: (_v, row) => (
          <span className={`font-mono-display ${row.is_logged === false ? "text-[#b8cfd3]" : "text-[#93b0b4]"}`}>
            {formatDate(row.date)}
          </span>
        ),
      },
      {
        key: "day",
        label: "Day",
        render: (_v, row) => (
          <span className={row.is_logged === false ? "text-[#b8cfd3] font-medium" : "text-[#0c1a1e] font-medium"}>
            {formatDay(row.date)}
          </span>
        ),
      },
      {
        key: "session_name",
        label: "Session",
        render: (_v, row) =>
          row.session_name ? (
            <span className={row.is_logged === false ? "text-[#b8cfd3]" : "text-[#0c1a1e]"}>
              {row.session_name}
            </span>
          ) : (
            renderDash()
          ),
      },
      {
        key: "completion_quality",
        label: "Status",
        chartType: "bar" as const,
        render: (_v, row) => renderStatus(row),
      },
      {
        key: "notes",
        label: "Notes",
        render: (_v, row) => {
          if (!row.notes) return renderDash();
          const truncated =
            row.notes.length > 50 ? row.notes.slice(0, 50) + "..." : row.notes;
          return <span className="text-sm text-[#93b0b4]">{truncated}</span>;
        },
      },
    ],
    []
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Dark summary strip */}
      <div className="bg-[#0f2027] rounded-[6px] p-5">
        {/* Program info row */}
        {plan && (
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-[rgba(255,255,255,0.5)]">
                {plan.name}
              </span>
              {plan.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-[rgba(255,255,255,0.3)] cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-sm">{plan.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
                {SPLIT_TYPE_LABELS[plan.splitType] || plan.splitType}
              </span>
              <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
                {plan.frequencyPerWeek}x/week
              </span>
              {plan.programDurationWeeks && (
                <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
                  {plan.programDurationWeeks} weeks
                </span>
              )}
            </div>
          </div>
        )}
        {/* Stat columns */}
        <div className="grid grid-cols-[1fr_1fr_1fr]">
        {/* SESSIONS COMPLETED */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            Sessions Completed
          </p>
          {summaryLoading ? (
            <Skeleton className="h-8 w-20 mt-1 bg-white/10" />
          ) : (
            <>
              <p className="text-[32px] font-bold leading-tight mt-1 text-white">
                {summary?.completed ?? 0}
              </p>
              <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
                of {summary?.totalPlanned ?? 0} planned
              </p>
            </>
          )}
        </div>

        {/* ADHERENCE */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            Adherence
          </p>
          {summaryLoading ? (
            <Skeleton className="h-7 w-16 mt-1 bg-white/10" />
          ) : (
            <>
              <p className="text-[22px] font-bold text-white mt-1">
                {adherencePct}
                <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">
                  %
                </span>
              </p>
              <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">
                {summary?.completed ?? 0}/{summary?.plannedUpToToday ?? 0} sessions
              </p>
            </>
          )}
        </div>

        {/* MISSED THIS WEEK */}
        <div className="flex flex-col pl-5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            Missed This Week
          </p>
          {summaryLoading ? (
            <Skeleton className="h-7 w-16 mt-1 bg-white/10" />
          ) : (
            <>
              <p className="text-[22px] font-bold text-white mt-1">
                {summary?.missed ?? 0}
              </p>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Section header: TRAINING LOG */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[10.5px] uppercase tracking-[0.07em] text-[#93b0b4] font-semibold whitespace-nowrap">
          Training Log
        </span>
        <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
      </div>

      {/* Table card */}
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<TrainingHistoryRow>
          columns={columns}
          data={rows}
          total={total}
          page={page}
          onPageChange={setPage}
          isLoading={isLoading}
          emptyMessage="No training sessions logged yet"
          onColumnClick={handleColumnClick}
        />
      </div>

      <HistoryChartDialog
        open={chartColumn !== null}
        onClose={() => setChartColumn(null)}
        title="Training Completion Quality"
        chartType="bar"
        data={chartData}
        dataKey="value"
        color="#0d9488"
      />
    </div>
  );
}
