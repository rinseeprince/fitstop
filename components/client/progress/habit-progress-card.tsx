"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyHabit } from "@/types/daily-habit";

interface HabitProgressCardProps {
  habit: DailyHabit;
  chartData: Array<{ date: string; completed: boolean }>;
  currentStreak: number;
  completionRate7d: number;
  completionRate30d: number;
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00');
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export function HabitProgressCard({
  habit,
  chartData,
  currentStreak,
  completionRate7d,
  completionRate30d,
}: HabitProgressCardProps) {
  // Transform chart data for Recharts
  const chartDataForDisplay = chartData.map(item => ({
    date: item.date,
    value: item.completed ? 1 : 0,
    completed: item.completed
  }));

  // Get completion badge color
  const getCompletionColor = (rate: number) => {
    if (rate >= 80) return "text-success bg-success/10";
    if (rate >= 60) return "text-warning bg-warning/10";
    return "text-destructive bg-destructive/10";
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="space-y-4">
          {/* Header with habit name and target */}
          <div>
            <h3 className="font-semibold text-base sm:text-lg text-foreground">
              {habit.name}
            </h3>
            {habit.targetValue && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Target: {habit.targetValue} {habit.targetUnit || ""}
              </p>
            )}
          </div>

          {/* Stats - Stacked on mobile, side by side on larger screens */}
          <div className="grid grid-cols-2 gap-3">
            {/* Current Streak */}
            <div className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Streak</p>
                <p className="text-base font-semibold">{currentStreak} days</p>
              </div>
            </div>

            {/* 7-Day Completion */}
            <div className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <Target className="w-4 h-4 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">7 day</p>
                <p className="text-base font-semibold">{completionRate7d}%</p>
              </div>
            </div>
          </div>

          {/* 30-day completion rate badge */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">30 day completion</span>
            <Badge 
              variant="secondary" 
              className={cn(
                "font-medium",
                getCompletionColor(completionRate30d)
              )}
            >
              {completionRate30d}%
            </Badge>
          </div>

          {/* Chart - Full width on mobile */}
          <div className="h-[120px] sm:h-[140px] w-full -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={chartDataForDisplay} 
                margin={{ top: 5, right: 5, bottom: 20, left: 5 }}
              >
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                  }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 500 }}
                  formatter={(value: number) => {
                    return [value > 0 ? "Completed" : "Missed", ""];
                  }}
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    return date.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
                <Bar
                  dataKey="value"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                >
                  {chartDataForDisplay.map((entry, index) => {
                    const color = entry.completed ? "#10b981" : "#e5e7eb";
                    return <Cell key={`cell-${index}`} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}