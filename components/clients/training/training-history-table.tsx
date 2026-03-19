"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { HistoryChartDialog } from "@/components/clients/history-table/history-chart-dialog";
import { useHistoryData } from "@/hooks/use-history-data";
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
  return <span className="text-muted-foreground">-</span>;
}

function renderStatus(quality: TrainingHistoryRow["completion_quality"]) {
  switch (quality) {
    case "full":
      return (
        <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
          Completed
        </span>
      );
    case "partial":
      return (
        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          Partial
        </span>
      );
    case "skipped":
      return (
        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
          Skipped
        </span>
      );
    default:
      return (
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
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
  const [page, setPage] = useState(0);
  const [chartColumn, setChartColumn] = useState<string | null>(null);

  const { rows, total, isLoading } = useHistoryData<TrainingHistoryRow>(
    `/api/clients/${clientId}/history/training`,
    page
  );

  const handleColumnClick = useCallback((key: string) => {
    setChartColumn(key);
  }, []);

  const chartData = useMemo(() => {
    if (!chartColumn || rows.length === 0) return [];
    return [...rows].reverse().map((row) => ({
      date: formatDate(row.date),
      value: row.completion_quality
        ? QUALITY_VALUES[row.completion_quality] ?? 0
        : 0,
    }));
  }, [chartColumn, rows]);

  const columns: ColumnDef<TrainingHistoryRow>[] = useMemo(() => [
    {
      key: "date",
      label: "Date",
      render: (_v, row) => formatDate(row.date),
    },
    {
      key: "day",
      label: "Day",
      render: (_v, row) => formatDay(row.date),
    },
    {
      key: "session_name",
      label: "Session",
      render: (_v, row) => row.session_name || renderDash(),
    },
    {
      key: "is_alternative",
      label: "Alt?",
      render: (_v, row) =>
        row.is_alternative ? (
          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
            Alt
          </span>
        ) : (
          renderDash()
        ),
    },
    {
      key: "completion_quality",
      label: "Status",
      chartType: "bar" as const,
      render: (_v, row) => renderStatus(row.completion_quality),
    },
    {
      key: "notes",
      label: "Notes",
      render: (_v, row) => {
        if (!row.notes) return renderDash();
        const truncated = row.notes.length > 50
          ? row.notes.slice(0, 50) + "..."
          : row.notes;
        return <span className="text-sm text-muted-foreground">{truncated}</span>;
      },
    },
  ], []);

  return (
    <Card>
      <CardContent className="pt-6">
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
      </CardContent>

      <HistoryChartDialog
        open={chartColumn !== null}
        onClose={() => setChartColumn(null)}
        title="Training Completion Quality"
        chartType="bar"
        data={chartData}
        dataKey="value"
        color="#22c55e"
      />
    </Card>
  );
}
