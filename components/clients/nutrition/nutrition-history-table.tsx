"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { TextSkeleton } from "@/components/text-skeleton";
import { useHistoryData, HISTORY_PAGE_SIZE } from "@/hooks/use-history-data";
import { swrFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { DividerPager } from "@/components/programs/shared/divider-pager";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { NutritionHistoryRow } from "@/types/history";

type NutritionSummary = {
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  days_logged: number;
  days_in_week: number;
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
  if (value == null) return <span className={cn(MONO, "text-[#93b0b4]")}>-</span>;
  if (target == null) return <span className={MONO}>{value}</span>;
  return <span className={MONO}>{value} / {target}</span>;
}

function getSurplusDeficitColor(value: number | null): string {
  if (value == null) return "text-[#93b0b4]";
  const abs = Math.abs(value);
  if (abs <= 100) return "text-surplus";
  if (abs <= 250) return "text-amber-500";
  return "text-fat";
}

function formatSurplusDeficit(value: number | null) {
  if (value == null) return <span className={cn(MONO, "text-[#93b0b4]")}>-</span>;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cn(MONO, getSurplusDeficitColor(value))}>
      {sign}{value}
    </span>
  );
}

function getAdherenceBadge(row: NutritionHistoryRow) {
  if (row.is_logged === false) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#f0f4f4] text-[#b8cfd3]">
        Not Logged
      </span>
    );
  }
  const adherence = row.nutrition_adherence;
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

  const { rows, total, isLoading, isError, mutate } = useHistoryData<NutritionHistoryRow>(
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
      render: (_v, row) => <span className={cn(MONO, row.is_logged === false ? "text-[#b8cfd3]" : "text-[#93b0b4]")}>{formatDate(row.date)}</span>,
    },
    {
      key: "day",
      label: "Day",
      render: (_v, row) => <span className={row.is_logged === false ? "text-[#b8cfd3] font-medium" : "text-[#0c1a1e] font-medium"}>{formatDay(row.date)}</span>,
    },
    {
      key: "calories_consumed",
      label: "Calories",
      render: (_v, row) => {
        if (row.is_logged === false) {
          return <span className={cn(MONO, "text-[#b8cfd3]")}>{row.target_calories != null ? `— / ${row.target_calories}` : "—"}</span>;
        }
        return renderMacro(row.calories_consumed, row.target_calories);
      },
    },
    {
      key: "protein_g",
      label: "Protein (g)",
      render: (_v, row) => {
        if (row.is_logged === false) return <span className={cn(MONO, "text-[#b8cfd3]")}>—</span>;
        return (
          <span className={cn(MONO, "text-protein")}>
            {row.protein_g != null ? `${row.protein_g}` : "-"}
            {row.target_protein_g != null && row.protein_g != null && (
              <span className="text-[#93b0b4]"> / {row.target_protein_g}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "carbs_g",
      label: "Carbs (g)",
      render: (_v, row) => {
        if (row.is_logged === false) return <span className={cn(MONO, "text-[#b8cfd3]")}>—</span>;
        return (
          <span className={cn(MONO, "text-carbs")}>
            {row.carbs_g != null ? `${row.carbs_g}` : "-"}
            {row.target_carbs_g != null && row.carbs_g != null && (
              <span className="text-[#93b0b4]"> / {row.target_carbs_g}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "fat_g",
      label: "Fat (g)",
      render: (_v, row) => {
        if (row.is_logged === false) return <span className={cn(MONO, "text-[#b8cfd3]")}>—</span>;
        return (
          <span className={cn(MONO, "text-fat")}>
            {row.fat_g != null ? `${row.fat_g}` : "-"}
            {row.target_fat_g != null && row.fat_g != null && (
              <span className="text-[#93b0b4]"> / {row.target_fat_g}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "calorie_surplus_deficit",
      label: "Surplus/Deficit",
      render: (_v, row) => {
        if (row.is_logged === false) return <span className={cn(MONO, "text-[#b8cfd3]")}>—</span>;
        return formatSurplusDeficit(row.calorie_surplus_deficit);
      },
    },
    {
      key: "nutrition_adherence",
      label: "Adherence",
      render: (_v, row) => getAdherenceBadge(row),
    },
  ], []);

  return (
    // Block flow, not flex-gap: divider spec = 16px above (strip mb-4), 12px
    // below (SectionLabel's own mb-3).
    <div>
      {/* Summary strip — unified dark card */}
      <div className="mb-4 bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-[1fr_1fr_1fr_1fr]">
        {/* Weekly total */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.08)]">
          <p className={STAT_LABEL_DARK_CLASS}>Weekly Total</p>
          {/* One tree for both states: pending renders inside the real
              elements, so the line boxes are identical by construction. */}
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[32px] leading-tight mt-1")}>
            {summaryLoading ? (
              <TextSkeleton className="w-24" />
            ) : summary ? (
              Math.round(summary.total_calories).toLocaleString()
            ) : (
              "-"
            )}
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
            {summaryLoading ? <TextSkeleton className="w-8" /> : "kcal"}
          </p>
          <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.35)] mt-auto pt-2")}>
            {summaryLoading ? (
              <TextSkeleton className="w-28" />
            ) : summary ? (
              `${avgCalories.toLocaleString()}/day \u00b7 ${daysLogged}/${summary.days_in_week} logged`
            ) : (
              "-"
            )}
          </p>
        </div>

        {/* Protein */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#2d8fb5]" />
            <p className={STAT_LABEL_DARK_CLASS}>Protein</p>
          </div>
          {summaryLoading ? (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
                <TextSkeleton className="w-14" />
              </p>
              <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>
                <TextSkeleton className="w-16" />
              </p>
            </>
          ) : (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
                {summary ? Math.round(summary.total_protein).toLocaleString() : "-"}
                <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
              </p>
              <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>{avgProtein}g/day</p>
            </>
          )}
        </div>

        {/* Carbs */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#c8923a]" />
            <p className={STAT_LABEL_DARK_CLASS}>Carbs</p>
          </div>
          {summaryLoading ? (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
                <TextSkeleton className="w-14" />
              </p>
              <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>
                <TextSkeleton className="w-16" />
              </p>
            </>
          ) : (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
                {summary ? Math.round(summary.total_carbs).toLocaleString() : "-"}
                <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
              </p>
              <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>{avgCarbs}g/day</p>
            </>
          )}
        </div>

        {/* Fat */}
        <div className="flex flex-col pl-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-[3px] h-[12px] rounded-[1px] bg-[#c06060]" />
            <p className={STAT_LABEL_DARK_CLASS}>Fat</p>
          </div>
          {summaryLoading ? (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
                <TextSkeleton className="w-14" />
              </p>
              <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>
                <TextSkeleton className="w-16" />
              </p>
            </>
          ) : (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
                {summary ? Math.round(summary.total_fat).toLocaleString() : "-"}
                <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">g</span>
              </p>
              <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>{avgFat}g/day</p>
            </>
          )}
        </div>
      </div>

      {/* Section header */}
      <SectionLabel
        label="Nutrition Logged"
        actions={
          <DividerPager
            page={page}
            total={total}
            pageSize={HISTORY_PAGE_SIZE}
            noun="days"
            onPageChange={setPage}
          />
        }
      />

      {/* Daily log table */}
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<NutritionHistoryRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          isError={Boolean(isError)}
          errorMessage="Could not load nutrition history"
          onRetry={() => void mutate()}
          emptyMessage="No nutrition data logged yet"
        />
      </div>
    </div>
  );
}
