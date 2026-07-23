"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { useHistoryData } from "@/hooks/use-history-data";
import { swrFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { WellnessMetric } from "@/utils/wellness-color-thresholds";
import type { WellnessHistoryRow } from "@/types/history";

type WellnessSummary = {
  avg_mood: number | null;
  avg_energy: number | null;
  avg_sleep: number | null;
  avg_stress: number | null;
  days_logged: number;
  days_in_window: number;
};

const METRICS: {
  key: keyof Pick<WellnessSummary, "avg_mood" | "avg_energy" | "avg_sleep" | "avg_stress">;
  label: string;
  metric: WellnessMetric;
  max: number;
}[] = [
  { key: "avg_mood", label: "Avg Mood", metric: "mood", max: 5 },
  { key: "avg_energy", label: "Avg Energy", metric: "energy", max: 10 },
  { key: "avg_sleep", label: "Avg Sleep", metric: "sleep", max: 10 },
  { key: "avg_stress", label: "Avg Stress", metric: "stress", max: 10 },
];

const PERIOD_OPTIONS = [7, 14, 28] as const;

// Teal Summit wellness colors: teal (good), white (neutral), amber (concerning)
function getWellnessColor(metric: WellnessMetric, value: number | null): string {
  if (value == null) return "#fff";
  switch (metric) {
    case "mood":
      if (value >= 4) return "#0d9488";
      if (value === 3) return "#fff";
      return "#d97706";
    case "energy":
      if (value >= 7) return "#0d9488";
      if (value >= 5) return "#fff";
      return "#d97706";
    case "sleep":
      if (value >= 7) return "#0d9488";
      if (value === 6) return "#fff";
      return "#d97706";
    case "stress":
      if (value <= 4) return "#0d9488";
      if (value <= 6) return "#fff";
      return "#d97706";
    default:
      return "#fff";
  }
}

// On white table background, neutral maps to primary text instead of white
function getTableColor(metric: WellnessMetric, value: number | null): string | undefined {
  const color = getWellnessColor(metric, value);
  if (color === "#fff") return undefined; // use default text color
  return color;
}

function hasWarning(metric: WellnessMetric, value: number | null): boolean {
  if (value == null) return false;
  if (metric === "sleep") return value <= 5;
  if (metric === "stress") return value >= 7;
  return false;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDay(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { weekday: "long" });
}

type Props = { clientId: string };

export function WellnessHistoryTable({ clientId }: Props) {
  const [page, setPage] = useState(0);
  const [days, setDays] = useState<7 | 14 | 28>(7);

  const { rows, total, isLoading } = useHistoryData<WellnessHistoryRow>(
    `/api/clients/${clientId}/history/wellness`,
    page
  );

  const { data: summary, isLoading: summaryLoading } = useSWR<WellnessSummary>(
    `/api/clients/${clientId}/history/wellness/summary?days=${days}`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  const columns: ColumnDef<WellnessHistoryRow>[] = useMemo(() => [
    { key: "date", label: "Date", render: (_v, row) => (
      <span className={cn(MONO, row.is_logged === false ? "text-[#b8cfd3]" : "text-[#93b0b4]")}>{formatDate(row.date)}</span>
    )},
    { key: "day", label: "Day", render: (_v, row) => (
      <span className={row.is_logged === false ? "text-[#b8cfd3] font-medium" : "text-[#0c1a1e] font-medium"}>{formatDay(row.date)}</span>
    )},
    { key: "mood", label: "Mood", render: (_v, row) => row.is_logged === false ? <span className="text-[#b8cfd3]">—</span> : renderMetricCell("mood", row.mood, 5) },
    { key: "energy", label: "Energy", render: (_v, row) => row.is_logged === false ? <span className="text-[#b8cfd3]">—</span> : renderMetricCell("energy", row.energy, 10) },
    { key: "sleep", label: "Sleep", render: (_v, row) => row.is_logged === false ? <span className="text-[#b8cfd3]">—</span> : renderMetricCell("sleep", row.sleep, 10) },
    { key: "stress", label: "Stress", render: (_v, row) => row.is_logged === false ? <span className="text-[#b8cfd3]">—</span> : renderMetricCell("stress", row.stress, 10) },
  ], []);

  return (
    // Block flow, not flex-gap: divider spec = 16px above (strip mb-4), 12px
    // below (SectionLabel's own mb-3).
    <div>
      {/* Period selector */}
      <div className="mb-4 flex justify-end">
        <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex">
          {PERIOD_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "px-4 py-1.5 text-[12.5px] font-medium rounded-[4px] transition-all",
                days === d
                  ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                  : "text-[#5a7d82] hover:text-[#0c1a1e]"
              )}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {/* Dark summary strip */}
      <div className="mb-4 bg-[#0f2027] rounded-[6px] p-5">
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr]">
          {METRICS.map(({ key, label, metric, max }, idx) => {
            const avg = summary ? summary[key] : null;
            const color = avg != null ? getWellnessColor(metric, Math.round(avg)) : "#fff";
            const warn = avg != null && hasWarning(metric, Math.round(avg));
            const isLast = idx === METRICS.length - 1;
            const isFirst = idx === 0;

            return (
              <div
                key={key}
                className={cn(
                  "flex flex-col",
                  isFirst ? "pr-5" : isLast ? "pl-5" : "pl-5 pr-5",
                  !isLast && (isFirst
                    ? "border-r border-[rgba(255,255,255,0.08)]"
                    : "border-r border-[rgba(255,255,255,0.06)]")
                )}
              >
                <div className="flex items-center gap-1.5">
                  {warn && (
                    <span className="w-[3px] h-[14px] rounded-[2px] bg-[#d97706]" />
                  )}
                  <p className={STAT_LABEL_DARK_CLASS}>
                    {label}
                  </p>
                </div>
                {summaryLoading ? (
                  <Skeleton className="h-7 w-16 mt-1 bg-white/10" />
                ) : (
                  <>
                    <p className={cn(MONO, "text-[22px] font-bold mt-1 tracking-[-0.03em]")} style={{ color }}>
                      {avg != null ? avg : "-"}
                      <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">
                        / {max}
                      </span>
                    </p>
                    <p className={cn(MONO, "text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>
                      {summary ? `${summary.days_logged}/${summary.days_in_window} days logged` : "-"}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Section header */}
      <SectionLabel
        label="Wellness Log"
        actions={
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-[3px] rounded-full bg-[#0d9488]" />
            <span className="text-[10.5px] text-[#93b0b4] font-medium">Good</span>
            <span className="w-2 h-[3px] rounded-full bg-[#d97706]" />
            <span className="text-[10.5px] text-[#93b0b4] font-medium">Warning</span>
          </div>
        }
      />

      {/* Table card */}
      <div className="bg-white rounded-[6px] p-5">
        <HistoryTable<WellnessHistoryRow>
          columns={columns}
          data={rows}
          total={total}
          page={page}
          onPageChange={setPage}
          isLoading={isLoading}
          emptyMessage="No wellness data logged yet"
        />
      </div>
    </div>
  );
}

function renderMetricCell(metric: WellnessMetric, value: number | null, max: number) {
  if (value == null) return <span className="text-[#93b0b4]">-</span>;
  const color = getTableColor(metric, value);
  return (
    <span className={cn(MONO, "text-[13px] font-semibold")} style={color ? { color } : undefined}>
      {value}
      <span className="font-normal text-[#93b0b4]"> / {max}</span>
    </span>
  );
}
