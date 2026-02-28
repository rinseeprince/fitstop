"use client";

import { useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Target, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyHabit } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";

interface ChartDataPoint {
  date: string;
  value: number;
  completed: boolean;
}

type HabitChartCardProps = {
  habit: DailyHabit & { stats?: HabitStats };
  chartData: ChartDataPoint[];
  averageValue: number | null;
  completionRate7d: number;
  completionRate30d: number;
  isHighlighted?: boolean;
  onRef?: (el: HTMLDivElement | null) => void;
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const getBarColor = (completed: boolean) => {
  return completed ? "#10b981" : "transparent";
};

export const HabitChartCard = ({
  habit,
  chartData,
  averageValue,
  completionRate7d,
  completionRate30d,
  isHighlighted,
  onRef,
}: HabitChartCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.classList.add("animate-pulse-ring");
      const timeout = setTimeout(() => {
        cardRef.current?.classList.remove("animate-pulse-ring");
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [isHighlighted]);
  
  const hasData = chartData.length > 0;
  const currentStreak = habit.stats?.currentStreak ?? 0;
  
  return (
    <Card
      ref={(el) => {
        cardRef.current = el;
        onRef?.(el);
      }}
      className={cn(
        "transition-all duration-200 overflow-hidden",
        isHighlighted && "ring-2 ring-primary shadow-lg"
      )}
    >
      <CardContent className="p-5">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              {habit.name}
              {habit.targetValue && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  Target: {habit.targetValue} {habit.targetUnit || ""}
                </span>
              )}
            </h3>
            {habit.description && (
              <p className="text-sm text-muted-foreground mt-1">{habit.description}</p>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current Streak</p>
                <p className="text-sm font-semibold">{currentStreak} days</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completion</p>
                <p className="text-sm font-semibold">
                  {completionRate7d}% <span className="text-muted-foreground">(7d)</span>
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">30d:</span>
              <span className="font-medium">{completionRate30d}%</span>
            </div>
          </div>
          
          {hasData ? (
            <div className="h-[140px] w-full -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
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
                      return [value > 0 ? "Completed" : "Missed", habit.name];
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
                    fill="#8b5cf6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  >
                    {chartData.map((entry, index) => {
                      const color = getBarColor(entry.completed);
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[140px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};