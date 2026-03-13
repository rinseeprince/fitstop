"use client";

import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { MiniBarSparkline } from "./mini-bar-sparkline";
import type { DailyLog } from "@/types/daily-log";
import type { WellnessMetric } from "@/utils/wellness-color-thresholds";

type WellnessSectionProps = {
  dailyLogs: DailyLog[];
  contextStartDate: Date;
  contextEndDate: Date;
};

type MetricConfig = {
  key: WellnessMetric;
  label: string;
  maxValue: number;
  scale: string;
};

const METRICS: MetricConfig[] = [
  { key: "mood", label: "Mood", maxValue: 5, scale: "/ 5" },
  { key: "energy", label: "Energy", maxValue: 10, scale: "/ 10" },
  { key: "sleep", label: "Sleep", maxValue: 10, scale: "/ 10" },
  { key: "stress", label: "Stress", maxValue: 10, scale: "/ 10" },
];

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function buildDayMap(dailyLogs: DailyLog[]): Map<string, DailyLog> {
  const map = new Map<string, DailyLog>();
  for (const log of dailyLogs) {
    map.set(log.date, log);
  }
  return map;
}

function getDayRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export const WellnessSection = ({
  dailyLogs,
  contextStartDate,
  contextEndDate,
}: WellnessSectionProps) => {
  const dayMap = buildDayMap(dailyLogs);
  const dateRange = getDayRange(contextStartDate, contextEndDate);

  // Check if there's any wellness data at all
  const hasWellnessData = dailyLogs.some(
    (l) => l.mood != null || l.energy != null || l.sleep != null || l.stress != null
  );
  if (!hasWellnessData) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.05 }}
      className="bg-card border border-border rounded-lg p-5"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4 flex items-center gap-2">
        <Heart className="w-4 h-4" />
        Wellness
      </div>
      <div className="grid grid-cols-4 gap-4">
        {METRICS.map((metric) => {
          const values = dateRange.map((date) => {
            const log = dayMap.get(date);
            return log?.[metric.key] ?? null;
          });

          const validValues = values.filter((v): v is number => v !== null);
          const avg =
            validValues.length > 0
              ? (validValues.reduce((a, b) => a + b, 0) / dateRange.length).toFixed(1)
              : "--";

          const barData = dateRange.map((date, i) => ({
            value: dayMap.get(date)?.[metric.key] ?? null,
            dayLabel: DAY_LABELS[i % 7],
          }));

          return (
            <div key={metric.key} className="text-center">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {metric.label}
              </div>
              <div className="text-2xl font-bold tracking-tight">
                {avg}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {metric.scale}
              </div>
              <MiniBarSparkline
                data={barData}
                metric={metric.key}
                maxValue={metric.maxValue}
              />
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};
