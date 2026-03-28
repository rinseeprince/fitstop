"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
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
  if (value == null) return <span className="text-[#93b0b4]">-</span>;
  if (target == null) return <span className="font-mono-display">{value}</span>;
  return <span className="font-mono-display">{value} / {target}</span>;
}

function getSurplusDeficitColor(value: number | null): string {
  if (value == null) return "text-[#93b0b4]";
  const abs = Math.abs(value);
  if (abs <= 100) return "text-surplus";
  if (abs <= 250) return "text-amber-500";
  return "text-fat";
}

function formatSurplusDeficit(value: number | null) {
  if (value == null) return <span className="text-[#93b0b4]">-</span>;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`font-mono-display ${getSurplusDeficitColor(value)}`}>
      {sign}{value}
    </span>
  );
}

function getAdherenceBadge(adherence: NutritionHistoryRow["nutrition_adherence"]) {
  if (!adherence) return <span className="text-[#93b0b4]">-</span>;
  const styles = {
    hit: "bg-[#e6f5f3] text-[#0d9488]",
    partial: "bg-amber-50 text-amber-500",
    missed: "bg-red-50 text-red-500",
  } as const;
  const labelMap = { hit: "Hit", partial: "Partial", missed: "Missed" } as const;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium ${styles[adherence]}`}>
      {labelMap[adherence]}
    </span>
  );
}

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

  const daysLogged = summary?.days_logged ?? 0;
  const avgCalories = daysLogged > 0 ? Math.round((summary?.total_calories ?? 0) / daysLogged) : 0;
  const avgProtein = daysLogged > 0 ? Math.round((summary?.total_protein ?? 0) / daysLogged) : 0;
  const avgCarbs = daysLogged > 0 ? Math.round((summary?.total_carbs ?? 0) / daysLogged) : 0;
  const avgFat = daysLogged > 0 ? Math.round((summary?.total_fat ?? 0) / daysLogged) : 0;

  const columns: ColumnDef<NutritionHistoryRow>[] = useMemo(() => [
    {
      key: "date",
      label: "Date",
      render: (_v, row) => <span className="text-[#93b0b4]">{formatDate(row.date)}</span>,
    },
    {
      key: "day",
      label: "Day",
      render: (_v, row) => <span className="text-[#0c1a1e] font-medium">{formatDay(row.date)}</span>,
    },
    {
      key: "calories_consumed",
      label: "Calories",
      render: (_v, row) => renderMacro(row.calories_consumed, row.target_calories),
    },
    {
      key: "protein_g",
      label: "Protein (g)",
      render: (_v, row) => (
        <span className="font-mono-display text-protein">
          {row.protein_g != null ? `${row.protein_g}` : "-"}
          {row.target_protein_g != null && row.protein_g != null && (
            <span className="text-[#93b0b4]"> / {row.target_protein_g}</span>
          )}
        </span>
      ),
    },
    {
      key: "carbs_g",
      label: "Carbs (g)",
      render: (_v, row) => (
        <span className="font-mono-display text-carbs">
          {row.carbs_g != null ? `${row.carbs_g}` : "-"}
          {row.target_carbs_g != null && row.carbs_g != null && (
            <span className="text-[#93b0b4]"> / {row.target_carbs_g}</span>
          )}
        </span>
      ),
    },
    {
      key: "fat_g",
      label: "Fat (g)",
      render: (_v, row) => (
        <span className="font-mono-display text-fat">
          {row.fat_g != null ? `${row.fat_g}` : "-"}
          {row.target_fat_g != null && row.fat_g != null && (
            <span className="text-[#93b0b4]"> / {row.target_fat_g}</span>
          )}
        </span>
      ),
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
    <div className="space-y-4">
      {/* Summary strip — same layout as Plans weekly overview */}
      <div className="grid grid-cols-4 gap-3">
        {/* Dark card: Total Calories */}
        <div className="bg-[#0f2027] text-white rounded-[6px] p-4">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Total Calories</p>
          {summaryLoading ? (
            <Skeleton className="h-8 w-24 mt-1 bg-white/10" />
          ) : (
            <>
              <p className="text-[32px] font-bold leading-tight mt-1">
                {summary ? Math.round(summary.total_calories).toLocaleString() : "-"}
              </p>
              <p className="text-sm text-[#93b0b4] font-mono-display mt-1">
                {summary ? `avg ${avgCalories.toLocaleString()}/day` : "-"}
              </p>
              <p className="text-xs text-[#93b0b4] mt-0.5">
                {summary ? `${daysLogged}/7 days logged` : ""}
              </p>
            </>
          )}
        </div>

        {/* Protein card */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[14px] rounded-full bg-protein" />
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Protein</p>
          </div>
          {summaryLoading ? (
            <Skeleton className="h-7 w-16 mt-1" />
          ) : (
            <>
              <p className="text-2xl font-bold text-[#0c1a1e]">
                {summary ? Math.round(summary.total_protein).toLocaleString() : "-"}
                <span className="text-base font-medium text-[#93b0b4]">g</span>
              </p>
              <p className="text-sm text-[#93b0b4] font-mono-display mt-1">avg {avgProtein}g/day</p>
            </>
          )}
        </div>

        {/* Carbs card */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[14px] rounded-full bg-carbs" />
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Carbs</p>
          </div>
          {summaryLoading ? (
            <Skeleton className="h-7 w-16 mt-1" />
          ) : (
            <>
              <p className="text-2xl font-bold text-[#0c1a1e]">
                {summary ? Math.round(summary.total_carbs).toLocaleString() : "-"}
                <span className="text-base font-medium text-[#93b0b4]">g</span>
              </p>
              <p className="text-sm text-[#93b0b4] font-mono-display mt-1">avg {avgCarbs}g/day</p>
            </>
          )}
        </div>

        {/* Fat card */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[14px] rounded-full bg-fat" />
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Fat</p>
          </div>
          {summaryLoading ? (
            <Skeleton className="h-7 w-16 mt-1" />
          ) : (
            <>
              <p className="text-2xl font-bold text-[#0c1a1e]">
                {summary ? Math.round(summary.total_fat).toLocaleString() : "-"}
                <span className="text-base font-medium text-[#93b0b4]">g</span>
              </p>
              <p className="text-sm text-[#93b0b4] font-mono-display mt-1">avg {avgFat}g/day</p>
            </>
          )}
        </div>
      </div>

      {/* Daily log table */}
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<NutritionHistoryRow>
          columns={columns}
          data={rows}
          total={total}
          page={page}
          onPageChange={setPage}
          isLoading={isLoading}
          emptyMessage="No nutrition data logged yet"
        />
      </div>
    </div>
  );
}
