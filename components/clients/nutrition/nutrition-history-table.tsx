"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { useHistoryData } from "@/hooks/use-history-data";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { NutritionHistoryRow } from "@/types/history";

type NutritionSummary = {
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  days_logged: number;
};

function formatDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDay(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { weekday: "long" });
}

function renderMacro(value: number | null, target: number | null) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  if (target == null) return <span>{value}</span>;
  return <span>{value} / {target}</span>;
}

function getSurplusDeficitColor(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  const abs = Math.abs(value);
  if (abs <= 100) return "text-success";
  if (abs <= 250) return "text-warning";
  return "text-destructive";
}

function formatSurplusDeficit(value: number | null) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={getSurplusDeficitColor(value)}>
      {sign}{value}
    </span>
  );
}

function getAdherenceBadge(adherence: NutritionHistoryRow["nutrition_adherence"]) {
  if (!adherence) return <span className="text-muted-foreground">-</span>;
  const variantMap = {
    hit: "success",
    partial: "warning",
    missed: "destructive",
  } as const;
  const labelMap = { hit: "Hit", partial: "Partial", missed: "Missed" } as const;
  return <Badge variant={variantMap[adherence]}>{labelMap[adherence]}</Badge>;
}

const SUMMARY_CARDS = [
  { key: "total_calories" as const, label: "Total Calories" },
  { key: "total_protein" as const, label: "Total Protein (g)" },
  { key: "total_carbs" as const, label: "Total Carbs (g)" },
  { key: "total_fat" as const, label: "Total Fat (g)" },
];

type Props = {
  clientId: string;
};

export function NutritionHistoryTable({ clientId }: Props) {
  const [page, setPage] = useState(0);

  const { rows, total, isLoading } = useHistoryData<NutritionHistoryRow>(
    `/api/clients/${clientId}/history/nutrition`,
    page
  );

  const { data: summary, isLoading: summaryLoading } = useSWR<NutritionSummary>(
    `/api/clients/${clientId}/history/nutrition/summary`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  const columns: ColumnDef<NutritionHistoryRow>[] = useMemo(() => [
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
      key: "calories_consumed",
      label: "Calories",
      render: (_v, row) => renderMacro(row.calories_consumed, row.target_calories),
    },
    {
      key: "protein_g",
      label: "Protein (g)",
      render: (_v, row) => renderMacro(row.protein_g, row.target_protein_g),
    },
    {
      key: "carbs_g",
      label: "Carbs (g)",
      render: (_v, row) => renderMacro(row.carbs_g, row.target_carbs_g),
    },
    {
      key: "fat_g",
      label: "Fat (g)",
      render: (_v, row) => renderMacro(row.fat_g, row.target_fat_g),
    },
    {
      key: "calorie_surplus_deficit",
      label: "Surplus/Deficit",
      render: (_v, row) => formatSurplusDeficit(row.calorie_surplus_deficit),
    },
    {
      key: "nutrition_adherence",
      label: "Adherence",
      render: (_v, row) => getAdherenceBadge(row.nutrition_adherence),
    },
  ], []);

  return (
    <div className="space-y-6">
      {/* 7-day summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {SUMMARY_CARDS.map(({ key, label }) => (
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
                  <p className="text-2xl font-semibold mt-1">
                    {summary ? Math.round(summary[key]).toLocaleString() : "-"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {summary ? `${summary.days_logged}/7 days logged` : "-"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <HistoryTable<NutritionHistoryRow>
            columns={columns}
            data={rows}
            total={total}
            page={page}
            onPageChange={setPage}
            isLoading={isLoading}
            emptyMessage="No nutrition data logged yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
