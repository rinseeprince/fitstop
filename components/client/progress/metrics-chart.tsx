"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Calendar } from "lucide-react";

interface MetricsChartProps {
  title: string;
  data: Array<{ date: string; [key: string]: any }>;
  metricKey: string;
  unit: string;
  icon?: React.ComponentType<{ className?: string }>;
  domain?: [number, number];
}

export function MetricsChart({ title, data, metricKey, unit, icon: Icon, domain }: MetricsChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {Icon && <Icon className="h-5 w-5" />}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentValue = data[data.length - 1]?.[metricKey];
  const previousValue = data.length > 1 ? data[data.length - 2]?.[metricKey] : null;
  
  const change = currentValue && previousValue ? currentValue - previousValue : null;
  const _trend = change === null ? "stable" : change > 0.1 ? "up" : change < -0.1 ? "down" : "stable";

  // Calculate chart visualization
  const chartData = data.slice(-14); // Last 14 points
  const values = chartData.map(d => d[metricKey]).filter(v => v != null);
  const minValue = domain ? domain[0] : Math.min(...values);
  const maxValue = domain ? domain[1] : Math.max(...values);
  const range = maxValue - minValue || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Current Value and Trend */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">
                {currentValue?.toFixed(1) || "--"}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {unit}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">Current</p>
            </div>
            {change !== null && (
              <TrendBadge change={change} unit={unit} />
            )}
          </div>

          {/* Simple chart visualization */}
          <div className="flex items-end gap-1 h-16">
            {chartData.map((point, idx) => {
              const value = point[metricKey];
              if (!value) return <div key={idx} className="flex-1" />;
              
              const height = ((value - minValue) / range) * 60 + 8;
              
              return (
                <div
                  key={idx}
                  className="flex-1 rounded-t bg-primary/80 min-h-[8px]"
                  style={{ height: `${height}px` }}
                  title={`${point.date}: ${value.toFixed(1)} ${unit}`}
                />
              );
            })}
          </div>
          
          <p className="text-xs text-muted-foreground text-center">
            Last {Math.min(chartData.length, 14)} recordings
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrendBadge({ change, unit }: { change: number; unit: string }) {
  const isIncrease = change > 0.1;
  const isDecrease = change < -0.1;

  return (
    <Badge
      variant={isIncrease ? "secondary" : isDecrease ? "default" : "outline"}
      className="flex items-center gap-1"
    >
      {isIncrease ? (
        <TrendingUp className="h-3 w-3" />
      ) : isDecrease ? (
        <TrendingDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      {isIncrease ? "+" : ""}
      {change.toFixed(1)} {unit}
    </Badge>
  );
}