"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { HistoryChartDialog } from "@/components/clients/history-table/history-chart-dialog";
import { useHistoryData } from "@/hooks/use-history-data";
import { SessionLogDetailDialog } from "@/components/clients/training/session-log-detail-dialog";
import { TrainingSummaryHero } from "@/components/clients/training/training-summary-hero";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { cn } from "@/lib/utils";
import {
  CHIP_NEUTRAL_CLASS,
  LABEL_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(0);
  const [chartColumn, setChartColumn] = useState<string | null>(null);
  const [selectedSessionLogId, setSelectedSessionLogId] = useState<string | null>(null);

  const handleExerciseDrillDown = useCallback(
    (exerciseId: string | null, exerciseName: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("subtab", "exercise-data");
      if (exerciseId) {
        params.set("exerciseId", exerciseId);
      } else {
        params.delete("exerciseId");
      }
      params.set("exerciseName", exerciseName);
      setSelectedSessionLogId(null);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const { rows, total, isLoading } = useHistoryData<TrainingHistoryRow>(
    `/api/clients/${clientId}/history/training`,
    page
  );
  const handleColumnClick = useCallback((key: string) => {
    setChartColumn(key);
  }, []);

  const handleRowClick = useCallback((row: TrainingHistoryRow) => {
    if (row.session_log_id) {
      setSelectedSessionLogId(row.session_log_id);
    }
  }, []);

  const isRowClickable = useCallback(
    (row: TrainingHistoryRow) => !!row.session_log_id,
    [],
  );

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
          <span className={cn(MONO, "tabular-nums", row.is_logged === false ? "text-[#b8cfd3]" : "text-[#93b0b4]")}>
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
            <span
              className={`inline-flex items-center gap-1.5 ${
                row.is_logged === false ? "text-[#b8cfd3]" : "text-[#0c1a1e]"
              }`}
            >
              {row.session_name}
              {row.is_alternative && (
                <span
                  title="Client logged a different session than prescribed"
                  className={cn(LABEL_CLASS, CHIP_NEUTRAL_CLASS, "font-semibold")}
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
    // Block flow, not flex-gap: the divider spec is 16px above (hero mb-4) and
    // 12px below (SectionLabel's own mb-3) — a flex gap would add to both.
    <div>
      <div className="mb-4">
        <TrainingSummaryHero clientId={clientId} />
      </div>

      {/* Section header: TRAINING LOG */}
      <SectionLabel label="Training Log" />

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
          onRowClick={handleRowClick}
          isRowClickable={isRowClickable}
        />
      </div>

      <SessionLogDetailDialog
        clientId={clientId}
        sessionLogId={selectedSessionLogId}
        open={selectedSessionLogId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSessionLogId(null);
        }}
        onExerciseDrillDown={handleExerciseDrillDown}
      />

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
