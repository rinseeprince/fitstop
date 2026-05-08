"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { KpiCard } from "./exercise-insight";

type ExerciseKpiStripProps = {
  kpis: KpiCard[];
  isLoading: boolean;
};

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

export function ExerciseKpiStrip({ kpis, isLoading }: ExerciseKpiStripProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-[10px]">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-[8px]" />
        ))}
      </div>
    );
  }

  if (kpis.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-[10px]">
      {kpis.map((kpi) => {
        const Icon = kpi.trend ? TREND_ICON[kpi.trend] : null;

        return (
          <div
            key={kpi.label}
            className="bg-white border border-[rgba(13,148,136,0.1)] rounded-[8px] px-[14px] py-[16px]"
          >
            <p className="text-[10px] uppercase tracking-[0.08em] text-[#93b0b4] font-medium">
              {kpi.label}
            </p>
            <p className="mt-1 font-mono-display tabular-nums">
              <span className="text-[22px] font-medium text-[#0c1a1e]">
                {kpi.value}
              </span>
              {kpi.unit && (
                <span className="text-[12px] text-[#93b0b4] ml-1">
                  {kpi.unit}
                </span>
              )}
            </p>
            {kpi.meta && (
              <p className="flex items-center gap-1 mt-1">
                {Icon && (
                  <Icon className="h-3 w-3 text-[#0d9488]" />
                )}
                <span className="text-[11px] font-medium text-[#0d9488]">
                  {kpi.meta}
                </span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
