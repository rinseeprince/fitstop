"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CheckIn } from "@/types/check-in";
import { prepareChartData } from "@/lib/check-in-utils";

type ProgressChartsProps = {
  checkIns: CheckIn[];
};

const CHART_COLORS = {
  weight: { stroke: "#8b5cf6", fill: "#8b5cf6" },
  adherence: { stroke: "#10b981", fill: "#10b981" },
  mood: { stroke: "#f59e0b", fill: "#f59e0b" },
  energy: { stroke: "#ef4444", fill: "#ef4444" },
};

type ChartTabProps = {
  data: Array<{ date: string; value: number }>;
  color: { stroke: string; fill: string };
  gradientId: string;
  domain?: [number | string, number | string];
  unit?: string;
  label: string;
};

const ChartTab = ({ data, color, gradientId, domain, unit, label }: ChartTabProps) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-muted-foreground text-sm">No {label.toLowerCase()} data</p>
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full min-h-[300px] mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color.fill} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color.fill} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            dy={8}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            domain={domain || ["auto", "auto"]}
            dx={-8}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 500 }}
            formatter={(value: number) => [`${value}${unit || ""}`, label]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color.stroke}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={{ fill: color.stroke, r: 4, strokeWidth: 2, stroke: "#fff" }}
            activeDot={{ r: 6, fill: color.stroke, strokeWidth: 2, stroke: "#fff" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const ProgressCharts = ({ checkIns }: ProgressChartsProps) => {
  const chartData = prepareChartData(checkIns);
  const hasData = checkIns.length > 0;

  if (!hasData) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No data available yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Check-ins will appear here as charts
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <Tabs defaultValue="weight" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="weight">Weight</TabsTrigger>
          <TabsTrigger value="adherence">Adherence</TabsTrigger>
          <TabsTrigger value="mood">Mood</TabsTrigger>
          <TabsTrigger value="energy">Energy</TabsTrigger>
        </TabsList>

        <TabsContent value="weight">
          <ChartTab
            data={chartData.weight}
            color={CHART_COLORS.weight}
            gradientId="weight-gradient"
            label="Weight"
            unit=" lbs"
          />
        </TabsContent>

        <TabsContent value="adherence">
          <ChartTab
            data={chartData.adherence}
            color={CHART_COLORS.adherence}
            gradientId="adherence-gradient"
            domain={[0, 100]}
            label="Adherence"
            unit="%"
          />
        </TabsContent>

        <TabsContent value="mood">
          <ChartTab
            data={chartData.mood}
            color={CHART_COLORS.mood}
            gradientId="mood-gradient"
            domain={[0, 5]}
            label="Mood"
            unit="/5"
          />
        </TabsContent>

        <TabsContent value="energy">
          <ChartTab
            data={chartData.energy}
            color={CHART_COLORS.energy}
            gradientId="energy-gradient"
            domain={[0, 10]}
            label="Energy"
            unit="/10"
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
};
