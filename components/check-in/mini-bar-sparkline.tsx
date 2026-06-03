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

// Teal Summit two-colour status: teal good, amber attention (no red); no-data muted.
function getBarColorClass(metric: WellnessMetric, value: number | null): string {
  if (value === null) return "bg-[rgba(13,148,136,0.12)]";

  switch (metric) {
    case "mood":
      return value >= 4 ? "bg-[#0d9488]" : "bg-[#d97706]";

    case "energy":
    case "sleep":
      return value >= 7 ? "bg-[#0d9488]" : "bg-[#d97706]";

    case "stress":
      // Inverted: lower is better
      return value <= 3 ? "bg-[#0d9488]" : "bg-[#d97706]";

    default:
      return "bg-[rgba(13,148,136,0.12)]";
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
            className="w-2 text-center text-[8px] text-[#93b0b4]"
          >
            {bar.dayLabel}
          </div>
        ))}
      </div>
    </div>
  );
};
