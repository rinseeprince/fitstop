"use client";

import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { HistoryChartDialog } from "@/components/clients/history-table/history-chart-dialog";
import { useHistoryData } from "@/hooks/use-history-data";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { BodyMetricsHistoryRow } from "@/types/history";

type BodyMetricsSummary = {
  current_weight: number | null;
  weight_unit: string | null;
};

const METRIC_COLORS: Record<string, string> = {
  weight: "#8b5cf6",
  body_fat_percentage: "#f43f5e",
  waist: "#3b82f6",
  hips: "#ec4899",
  chest: "#8b5cf6",
  arms: "#06b6d4",
  thighs: "#10b981",
};

const METRIC_LABELS: Record<string, string> = {
  weight: "Weight",
  body_fat_percentage: "Body Fat %",
  waist: "Waist",
  hips: "Hips",
  chest: "Chest",
  arms: "Arms",
  thighs: "Thighs",
};

function formatPeriodLabel(row: BodyMetricsHistoryRow): string {
  if (row.period_start && row.period_end) {
    const start = new Date(row.period_start + "T00:00:00");
    const end = new Date(row.period_end + "T00:00:00");
    const startStr = start.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-AU", { day: "numeric" });
    return `${startStr} - ${endStr}`;
  }
  const date = new Date(row.created_at);
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function renderDash() {
  return <span className="text-muted-foreground">-</span>;
}

function renderWeight(row: BodyMetricsHistoryRow) {
  if (row.weight == null) return renderDash();
  const unit = row.weight_unit || "lbs";
  return <span>{row.weight} {unit}</span>;
}

function renderMeasurement(value: number | null, unit: string | null) {
  if (value == null) return renderDash();
  return <span>{value}{unit ? ` ${unit}` : ""}</span>;
}

function renderPercent(value: number | null) {
  if (value == null) return renderDash();
  return <span>{value}%</span>;
}

function formatWeightChange(current: number | null, start: number | null, goal: number | null, unit: string) {
  if (current == null || start == null) return null;
  const diff = Math.round((current - start) * 10) / 10;
  if (diff === 0) return { text: `0 ${unit}`, color: "text-muted-foreground" };

  const sign = diff > 0 ? "+" : "";
  // Moving toward goal is green, away is red
  const isPositive = goal != null
    ? (goal < start ? diff < 0 : diff > 0)
    : diff < 0; // Default: weight loss is positive
  const color = isPositive ? "text-success" : "text-destructive";
  return { text: `${sign}${diff} ${unit}`, color };
}

type Props = {
  clientId: string;
  goalWeight: number | null;
  goalBodyFat: number | null;
  startingWeight: number | null;
  weightUnit: string;
};

export function BodyMetricsHistoryTable({ clientId, goalWeight, goalBodyFat, startingWeight, weightUnit }: Props) {
  const [page, setPage] = useState(0);
  const [chartColumn, setChartColumn] = useState<string | null>(null);

  const { rows, total, isLoading } = useHistoryData<BodyMetricsHistoryRow>(
    `/api/clients/${clientId}/history/body-metrics`,
    page
  );

  const { data: summary, isLoading: summaryLoading } = useSWR<BodyMetricsSummary>(
    `/api/clients/${clientId}/history/body-metrics/summary`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  const currentWeight = summary?.current_weight ?? null;
  const displayUnit = summary?.weight_unit || weightUnit;
  const weightChange = formatWeightChange(currentWeight, startingWeight, goalWeight, displayUnit);

  const handleColumnClick = useCallback((key: string) => {
    setChartColumn(key);
  }, []);

  const chartData = useMemo(() => {
    if (!chartColumn || rows.length === 0) return [];
    return [...rows]
      .reverse()
      .filter((row) => row[chartColumn as keyof BodyMetricsHistoryRow] != null)
      .map((row) => ({
        date: formatPeriodLabel(row),
        value: row[chartColumn as keyof BodyMetricsHistoryRow] as number,
      }));
  }, [chartColumn, rows]);

  const chartReference = useMemo(() => {
    if (chartColumn === "weight" && goalWeight != null)
      return { value: goalWeight, label: `Goal: ${goalWeight}` };
    if (chartColumn === "body_fat_percentage" && goalBodyFat != null)
      return { value: goalBodyFat, label: `Goal: ${goalBodyFat}%` };
    return { value: null, label: undefined };
  }, [chartColumn, goalWeight, goalBodyFat]);

  const columns: ColumnDef<BodyMetricsHistoryRow>[] = useMemo(() => [
    {
      key: "period",
      label: "Check-In Period",
      render: (_v, row) => formatPeriodLabel(row),
    },
    {
      key: "weight",
      label: "Weight",
      chartType: "line" as const,
      render: (_v, row) => renderWeight(row),
    },
    {
      key: "body_fat_percentage",
      label: "Body Fat %",
      chartType: "line" as const,
      render: (_v, row) => renderPercent(row.body_fat_percentage),
    },
    {
      key: "waist",
      label: "Waist",
      chartType: "line" as const,
      render: (_v, row) => renderMeasurement(row.waist, row.measurement_unit),
    },
    {
      key: "hips",
      label: "Hips",
      chartType: "line" as const,
      render: (_v, row) => renderMeasurement(row.hips, row.measurement_unit),
    },
    {
      key: "chest",
      label: "Chest",
      chartType: "line" as const,
      render: (_v, row) => renderMeasurement(row.chest, row.measurement_unit),
    },
    {
      key: "arms",
      label: "Arms",
      chartType: "line" as const,
      render: (_v, row) => renderMeasurement(row.arms, row.measurement_unit),
    },
    {
      key: "thighs",
      label: "Thighs",
      chartType: "line" as const,
      render: (_v, row) => renderMeasurement(row.thighs, row.measurement_unit),
    },
  ], []);

  const summaryCards = [
    { label: "Current Weight", value: currentWeight, unit: displayUnit },
    { label: "Start Weight", value: startingWeight, unit: weightUnit },
    { label: "Goal Weight", value: goalWeight, unit: weightUnit },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {summaryCards.map(({ label, value, unit }) => (
          <Card key={label}>
            <CardContent className="p-4">
              {summaryLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <p className="text-2xl font-semibold">
                      {value != null ? `${value} ${unit}` : "-"}
                    </p>
                    {label === "Current Weight" && weightChange && (
                      <span className={`text-sm font-medium ${weightChange.color}`}>
                        {weightChange.text}
                      </span>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <HistoryTable<BodyMetricsHistoryRow>
            columns={columns}
            data={rows}
            total={total}
            page={page}
            onPageChange={setPage}
            isLoading={isLoading}
            emptyMessage="No body metrics logged yet"
            onColumnClick={handleColumnClick}
          />
        </CardContent>
      </Card>

      <HistoryChartDialog
        open={chartColumn !== null}
        onClose={() => setChartColumn(null)}
        title={chartColumn ? `${METRIC_LABELS[chartColumn] || chartColumn} Trend` : ""}
        chartType="line"
        data={chartData}
        dataKey="value"
        color={chartColumn ? METRIC_COLORS[chartColumn] || "#8b5cf6" : "#8b5cf6"}
        referenceValue={chartReference.value}
        referenceLabel={chartReference.label}
      />
    </div>
  );
}
