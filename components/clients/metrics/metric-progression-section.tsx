"use client";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { addDaysToDate } from "@/utils/metric-points";
import { getTodayDateString } from "@/lib/date-helpers";
import { MetricStatCards } from "./metric-stat-cards";
import { MetricTrendChart } from "./metric-trend-chart";
import type { BlockBandIdentity } from "./blocks/block-chart-bands";
import type { MetricSummary } from "./metrics-view-types";

// PROGRESSION rail + 30/60/90/All window control + stat cards + entry chart.
// The range filters the CHART's points only — every derived stat on the cards
// is computed upstream from the full series.

type ProgressionRange = 30 | 60 | 90 | "all";

type MetricProgressionSectionProps = {
  metric: MetricSummary;
  range: ProgressionRange;
  onRangeChange: (r: ProgressionRange) => void;
  onLogFirst: () => void;
  blockBands?: BlockBandIdentity[];
  showBlocks?: boolean;
  onToggleBlocks?: (show: boolean) => void;
};

const RANGE_OPTIONS: { value: ProgressionRange; label: string }[] = [
  { value: 30, label: "30" },
  { value: 60, label: "60" },
  { value: 90, label: "90" },
  { value: "all", label: "All" },
];

export function MetricProgressionSection({
  metric,
  range,
  onRangeChange,
  onLogFirst,
  blockBands,
  showBlocks,
  onToggleBlocks,
}: MetricProgressionSectionProps) {
  const filtered =
    range === "all"
      ? metric.points
      : metric.points.filter(
          (p) => p.date >= addDaysToDate(getTodayDateString(), -(range - 1))
        );

  return (
    // Block flow, not space-y: divider spec = 16px above each rail (mb-4 on the
    // prior block), 12px below (SectionLabel's mb-3) — exercise-data-view's
    // spacing contract.
    <div>
      <SectionLabel
        label="Progression"
        actions={
          <div className="flex items-center gap-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={range === opt.value}
                onClick={() => onRangeChange(opt.value)}
                className={cn(
                  LABEL_CLASS,
                  "rounded-[6px] px-2 py-1 text-[11px] transition-colors",
                  range === opt.value
                    ? "bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
                    : "hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488]"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {metric.points.length === 0 ? (
        // Zero entries: cards + chart collapse into one quiet invitation card.
        <div className="mb-4">
          <div className="bg-white rounded-[6px] py-12 px-5 text-center">
            <p className="text-sm text-[#5a7d82]">
              No {metric.name} entries yet
            </p>
            <p className="text-xs text-[#93b0b4] mt-1">
              Entries from check-ins and coach logs will chart here.
            </p>
            <button
              type="button"
              onClick={onLogFirst}
              className="mt-3 text-[13px] font-medium text-[#0d9488] hover:text-[#0b7f75]"
            >
              Log the first entry
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <MetricStatCards metric={metric} />
          </div>
          {/* The section's closing mb-4 = the 16px above the next rail */}
          <div className="mb-4">
            <MetricTrendChart
              metric={metric}
              points={filtered}
              windowDays={range === "all" ? null : range}
              blockBands={blockBands}
              showBlocks={showBlocks}
              onToggleBlocks={onToggleBlocks}
            />
          </div>
        </>
      )}
    </div>
  );
}
