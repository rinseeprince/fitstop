"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { useHistoryData } from "@/hooks/use-history-data";
import { swrFetcher } from "@/lib/swr-fetcher";
import { getBarColor, type WellnessMetric } from "@/utils/wellness-color-thresholds";
import type { WellnessHistoryRow } from "@/types/history";

type WellnessSummary = {
  avg_mood: number | null;
  avg_energy: number | null;
  avg_sleep: number | null;
  avg_stress: number | null;
  days_logged: number;
};

const SUMMARY_CARDS: {
  key: keyof Omit<WellnessSummary, "days_logged">;
  label: string;
  metric: WellnessMetric;
  max: number;
}[] = [
  { key: "avg_mood", label: "Avg Mood", metric: "mood", max: 5 },
  { key: "avg_energy", label: "Avg Energy", metric: "energy", max: 10 },
  { key: "avg_sleep", label: "Avg Sleep", metric: "sleep", max: 10 },
  { key: "avg_stress", label: "Avg Stress", metric: "stress", max: 10 },
];

function formatDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDay(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { weekday: "long" });
}

function renderWellnessValue(metric: WellnessMetric, value: number | null) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  const color = getBarColor(metric, value);
  // Green (good range) renders as default text; only amber/red get color
  if (color === "#10b981") return <span className="font-medium">{value}</span>;
  return <span style={{ color }} className="font-medium">{value}</span>;
}

function truncateNotes(notes: string | null) {
  if (!notes) return <span className="text-muted-foreground">-</span>;
  if (notes.length <= 50) return <span>{notes}</span>;
  return <span title={notes}>{notes.slice(0, 47)}...</span>;
}

type Props = {
  clientId: string;
};

export function WellnessHistoryTable({ clientId }: Props) {
  const [page, setPage] = useState(0);

  const { rows, total, isLoading } = useHistoryData<WellnessHistoryRow>(
    `/api/clients/${clientId}/history/wellness`,
    page
  );

  const { data: summary, isLoading: summaryLoading } = useSWR<WellnessSummary>(
    `/api/clients/${clientId}/history/wellness/summary`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  const columns: ColumnDef<WellnessHistoryRow>[] = useMemo(() => [
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
      key: "mood",
      label: "Mood (1-5)",
      render: (_v, row) => renderWellnessValue("mood", row.mood),
    },
    {
      key: "energy",
      label: "Energy (1-10)",
      render: (_v, row) => renderWellnessValue("energy", row.energy),
    },
    {
      key: "sleep",
      label: "Sleep (1-10)",
      render: (_v, row) => renderWellnessValue("sleep", row.sleep),
    },
    {
      key: "stress",
      label: "Stress (1-10)",
      render: (_v, row) => renderWellnessValue("stress", row.stress),
    },
    {
      key: "notes",
      label: "Notes",
      render: (_v, row) => truncateNotes(row.notes),
    },
  ], []);

  return (
    <div className="space-y-6">
      {/* 7-day average summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {SUMMARY_CARDS.map(({ key, label, metric, max }) => {
          const avg = summary ? summary[key] : null;
          const rawColor = avg != null ? getBarColor(metric, Math.round(avg)) : undefined;
          // Green (good range) renders as default text; only amber/red get color
          const color = rawColor === "#10b981" ? undefined : rawColor;

          return (
            <Card key={key}>
              <CardContent className="p-4">
                {summaryLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold mt-1" style={color ? { color } : undefined}>
                      {avg != null ? `${avg} / ${max}` : "-"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {summary ? `${summary.days_logged}/7 days logged` : "-"}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6">
          <HistoryTable<WellnessHistoryRow>
            columns={columns}
            data={rows}
            total={total}
            page={page}
            onPageChange={setPage}
            isLoading={isLoading}
            emptyMessage="No wellness data logged yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
