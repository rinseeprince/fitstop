"use client";

import type { WellnessMetric } from "@/utils/wellness-color-thresholds";

type BarData = {
  value: number | null;
  dayLabel: string;
};

type MiniBarSparklineProps = {
  data: BarData[];
  metric: WellnessMetric;
  maxValue: number;
};

function getBarColorClass(metric: WellnessMetric, value: number | null): string {
  if (value === null) return "bg-muted";

  switch (metric) {
    case "mood":
      if (value >= 4) return "bg-success";
      if (value === 3) return "bg-warning";
      return "bg-destructive";

    case "energy":
    case "sleep":
      if (value >= 7) return "bg-success";
      if (value >= 4) return "bg-warning";
      return "bg-destructive";

    case "stress":
      // Inverted: lower is better
      if (value <= 3) return "bg-success";
      if (value <= 6) return "bg-warning";
      return "bg-destructive";

    default:
      return "bg-muted";
  }
}

export const MiniBarSparkline = ({ data, metric, maxValue }: MiniBarSparklineProps) => {
  return (
    <div>
      <div className="flex gap-[3px] justify-center items-end h-8 mt-2.5">
        {data.map((bar, i) => {
          const heightPct = bar.value !== null ? (bar.value / maxValue) * 100 : 0;
          const colorClass = getBarColorClass(metric, bar.value);
          return (
            <div
              key={i}
              className={`w-2 rounded-sm ${colorClass} transition-all duration-200`}
              style={{ height: `${Math.max(heightPct, 4)}%` }}
              title={bar.value !== null ? `${bar.dayLabel}: ${bar.value}` : `${bar.dayLabel}: No data`}
            />
          );
        })}
      </div>
      <div className="flex gap-[3px] justify-center mt-1">
        {data.map((bar, i) => (
          <div
            key={i}
            className="w-2 text-center text-[8px] text-muted-foreground"
          >
            {bar.dayLabel}
          </div>
        ))}
      </div>
    </div>
  );
};
