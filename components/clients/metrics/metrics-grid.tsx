"use client";

import { MetricChartCard } from "@/components/metrics/metric-chart-card";
import type { MetricData } from "./hooks/use-metrics-data";

type MetricsGridProps = {
  metrics: MetricData[];
  selectedMetricId: string | null;
  onClearSelection: () => void;
};

// Date scoping is driven by the tab-level time-scope selector (Session 7.5),
// not a per-grid dropdown — the grid just renders the (already-windowed) charts.
export const MetricsGrid = ({
  metrics,
  selectedMetricId,
  onClearSelection,
}: MetricsGridProps) => {
  const selectedMetric = selectedMetricId
    ? metrics.find((m) => m.id === selectedMetricId)
    : null;

  if (selectedMetric) {
    return (
      <div className="flex-1 h-full">
        <MetricChartCard
          key={selectedMetric.id}
          id={selectedMetric.id}
          name={selectedMetric.name}
          currentValue={selectedMetric.currentValue}
          unit={selectedMetric.unit}
          percentChange={selectedMetric.percentChange}
          trend={selectedMetric.trend}
          chartData={selectedMetric.chartData}
          expanded
          onBack={onClearSelection}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4">
      {metrics.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {metrics.map((metric) => (
            <MetricChartCard
              key={metric.id}
              id={metric.id}
              name={metric.name}
              currentValue={metric.currentValue}
              unit={metric.unit}
              percentChange={metric.percentChange}
              trend={metric.trend}
              chartData={metric.chartData}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          <p>No metrics data available for this time range</p>
        </div>
      )}
    </div>
  );
};
