"use client";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";
import { MetricListItem } from "./metric-list-item";
import type { MetricData, MetricCategory } from "./hooks/use-metrics-data";

type MetricsSidebarProps = {
  bodyMetrics: MetricData[];
  wellnessMetrics: MetricData[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  category: MetricCategory;
  onCategoryChange: (category: MetricCategory) => void;
  selectedMetricId: string | null;
  onSelectMetric: (id: string) => void;
};

export const MetricsSidebar = ({
  bodyMetrics,
  wellnessMetrics,
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  selectedMetricId,
  onSelectMetric,
}: MetricsSidebarProps) => {
  const filterMetrics = (metrics: MetricData[]) =>
    metrics.filter((m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const filteredBodyMetrics = filterMetrics(bodyMetrics);
  const filteredWellnessMetrics = filterMetrics(wellnessMetrics);

  return (
    <div className="w-[280px] flex flex-col border rounded-lg bg-card">
      <div className="p-4 border-b space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search metrics..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs
        value={category}
        onValueChange={(v) => onCategoryChange(v as MetricCategory)}
        className="flex-1 flex flex-col"
      >
        <TabsList className="grid grid-cols-2 m-4 mb-0">
          <TabsTrigger value="body">Body Metrics</TabsTrigger>
          <TabsTrigger value="wellness">Wellness</TabsTrigger>
        </TabsList>

        <TabsContent value="body" className="flex-1 mt-0">
          <ScrollArea className="h-[400px]">
            <div className="p-2 space-y-1">
              {filteredBodyMetrics.length > 0 ? (
                filteredBodyMetrics.map((metric) => (
                  <MetricListItem
                    key={metric.id}
                    id={metric.id}
                    name={metric.name}
                    value={metric.currentValue}
                    unit={metric.unit}
                    lastUpdated={metric.lastUpdated}
                    isSelected={metric.id === selectedMetricId}
                    onClick={() => onSelectMetric(metric.id)}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No body metrics found
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="wellness" className="flex-1 mt-0">
          <ScrollArea className="h-[400px]">
            <div className="p-2 space-y-1">
              {filteredWellnessMetrics.length > 0 ? (
                filteredWellnessMetrics.map((metric) => (
                  <MetricListItem
                    key={metric.id}
                    id={metric.id}
                    name={metric.name}
                    value={metric.currentValue}
                    unit={metric.unit}
                    lastUpdated={metric.lastUpdated}
                    isSelected={metric.id === selectedMetricId}
                    onClick={() => onSelectMetric(metric.id)}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No wellness metrics found
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};
