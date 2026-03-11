"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricChartCard } from "./metric-chart-card";
import type { MetricData, DateRangeFilter } from "./hooks/use-metrics-data";

type MetricsGridProps = {
  metrics: MetricData[];
  dateRange: DateRangeFilter;
  onDateRangeChange: (range: DateRangeFilter) => void;
  selectedMetricId: string | null;
  onClearSelection: () => void;
};

const DATE_RANGE_OPTIONS: { value: DateRangeFilter; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const MetricsGrid = ({
  metrics,
  dateRange,
  onDateRangeChange,
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
          dateRange={dateRange}
          onDateRangeChange={onDateRangeChange}
          onBack={onClearSelection}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-end">
        <Select value={dateRange} onValueChange={(v) => onDateRangeChange(v as DateRangeFilter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
