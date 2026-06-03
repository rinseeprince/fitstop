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

const SHORT_DAY = ["S", "M", "T", "W", "T", "F", "S"];

function buildDayMap(dailyLogs: DailyLog[]): Map<string, DailyLog> {
  const map = new Map<string, DailyLog>();
  for (const log of dailyLogs) {
    map.set(log.date, log);
  }
  return map;
}

// Returns date strings and day labels derived from local date components
function getDayRange(start: Date, end: Date): { date: string; dayLabel: string }[] {
  const days: { date: string; dayLabel: string }[] = [];
  const d = new Date(start);
  while (d <= end) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    days.push({ date: dateStr, dayLabel: SHORT_DAY[d.getDay()] });
    d.setDate(d.getDate() + 1);
  }
  return days;
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
      className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[#5a7d82] mb-4 flex items-center gap-2">
        <Heart className="w-4 h-4" strokeWidth={1.5} />
        Wellness
      </div>
      <div className="grid grid-cols-4 gap-4">
        {METRICS.map((metric) => {
          const values = dateRange.map((day) => {
            const log = dayMap.get(day.date);
            return log?.[metric.key] ?? null;
          });

          const validValues = values.filter((v): v is number => v !== null);
          const avg =
            validValues.length > 0
              ? (validValues.reduce((a, b) => a + b, 0) / dateRange.length).toFixed(1)
              : "--";

          const barData = dateRange.map((day) => ({
            value: dayMap.get(day.date)?.[metric.key] ?? null,
            dayLabel: day.dayLabel,
          }));

          return (
            <div key={metric.key} className="text-center">
              <div className="text-xs font-medium text-[#93b0b4] mb-2">
                {metric.label}
              </div>
              <div className="text-2xl font-bold tracking-tight font-mono-display text-[#0c1a1e]">
                {avg}
              </div>
              <div className="text-[11px] text-[#93b0b4]">
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
