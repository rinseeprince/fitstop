"use client";

import { cn } from "@/lib/utils";

export type PerformanceMetric = "weight" | "e1rm" | "volume";
export type PerformanceSessionCount = 12 | 24 | "all";

const METRICS: { value: PerformanceMetric; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "e1rm", label: "e1RM" },
  { value: "volume", label: "Volume" },
];

const SESSION_COUNTS: { value: PerformanceSessionCount; label: string }[] = [
  { value: 12, label: "12" },
  { value: 24, label: "24" },
  { value: "all", label: "All" },
];

type PerformanceControlsProps = {
  metric: PerformanceMetric;
  onMetricChange: (metric: PerformanceMetric) => void;
  sessionCount: PerformanceSessionCount;
  onSessionCountChange: (sessionCount: PerformanceSessionCount) => void;
};

// Two light-themed segmented controls: metric (Weight/e1RM/Volume) on the left,
// session-count window (12/24/All) on the right. Client subset — no RPE/Compliance.
export function PerformanceControls({
  metric,
  onMetricChange,
  sessionCount,
  onSessionCountChange,
}: PerformanceControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented
        ariaLabel="Metric"
        options={METRICS}
        value={metric}
        onChange={onMetricChange}
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#93b0b4]">
          Last
        </span>
        <Segmented
          ariaLabel="Sessions"
          options={SESSION_COUNTS}
          value={sessionCount}
          onChange={onSessionCountChange}
        />
        <span className="text-[12px] text-[#93b0b4]">sessions</span>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-[6px] bg-[rgba(13,148,136,0.06)] p-[3px]"
    >
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            "rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-all",
            value === opt.value
              ? "bg-white text-[#0d9488] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
              : "text-[#5a7d82] hover:text-[#0c1a1e]",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
