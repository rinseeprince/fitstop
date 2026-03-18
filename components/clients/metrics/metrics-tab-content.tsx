"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricsSidebar } from "./metrics-sidebar";
import { MetricsGrid } from "./metrics-grid";
import { BodyMetricsHistoryTable } from "./body-metrics-history-table";
import { useMetricsData, type DateRangeFilter, type MetricCategory } from "./hooks/use-metrics-data";
import type { CheckIn, Client } from "@/types/check-in";

type MetricsTabContentProps = {
  checkIns: CheckIn[];
  client: Client;
  isLoading: boolean;
};

export const MetricsTabContent = ({
  checkIns,
  client,
  isLoading,
}: MetricsTabContentProps) => {
  const [dateRange, setDateRange] = useState<DateRangeFilter>("30d");
  const [category, setCategory] = useState<MetricCategory>("body");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);

  const { bodyMetrics, wellnessMetrics } = useMetricsData(
    checkIns,
    dateRange,
    client.weightUnit,
    "in" // Default measurement unit
  );

  const displayedMetrics = category === "body" ? bodyMetrics : wellnessMetrics;

  const filteredDisplayedMetrics = searchQuery
    ? displayedMetrics.filter((m) =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayedMetrics;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading metrics...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (checkIns.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <p className="font-medium">No check-in data available</p>
            <p className="text-sm text-muted-foreground">
              Send a check-in request to start tracking metrics
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-6 items-start">
        <MetricsSidebar
          bodyMetrics={bodyMetrics}
          wellnessMetrics={wellnessMetrics}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          category={category}
          onCategoryChange={setCategory}
          selectedMetricId={selectedMetricId}
          onSelectMetric={setSelectedMetricId}
        />
        <MetricsGrid
          metrics={filteredDisplayedMetrics}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          selectedMetricId={selectedMetricId}
          onClearSelection={() => setSelectedMetricId(null)}
        />
      </div>
      <BodyMetricsHistoryTable
        clientId={client.id}
        goalWeight={client.goalWeight ?? null}
        goalBodyFat={client.goalBodyFatPercentage ?? null}
        startingWeight={client.startingWeight ?? null}
        weightUnit={client.weightUnit ?? "lbs"}
      />
    </div>
  );
};
