"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  MONO,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { MiniBarSparkline } from "./mini-bar-sparkline";
import type { DailyLog } from "@/types/daily-log";
import type { CheckInComparison, MetricChange } from "@/types/check-in";
import type { WellnessMetric } from "@/utils/wellness-color-thresholds";

type WellnessSectionProps = {
  dailyLogs: DailyLog[];
  contextStartDate: Date;
  contextEndDate: Date;
  /** Week-over-week changes; null while the comparison read is in flight or has failed. */
  changes: CheckInComparison["changes"] | null;
};

type MetricConfig = {
  key: WellnessMetric;
  label: string;
  maxValue: number;
  scale: string;
  /** Down is GOOD — stress and soreness, like every other surface. */
  inverse?: boolean;
};

const METRICS: MetricConfig[] = [
  { key: "mood", label: "Mood", maxValue: 5, scale: "/ 5" },
  { key: "energy", label: "Energy", maxValue: 10, scale: "/ 10" },
  { key: "sleep", label: "Sleep", maxValue: 10, scale: "/ 10" },
  { key: "stress", label: "Stress", maxValue: 10, scale: "/ 10", inverse: true },
  { key: "soreness", label: "Soreness", maxValue: 10, scale: "/ 10", inverse: true },
];

// Good direction teal, bad amber, no comparison muted. Teal Summit is a
// two-colour status system — there is no red.
function deltaClass(change: MetricChange | undefined, inverse: boolean): string {
  if (!change || change.previous === undefined) return "text-[#93b0b4]";
  if (change.trend === "down") return inverse ? "text-[#0d9488]" : "text-[#d97706]";
  if (change.trend === "up") return inverse ? "text-[#d97706]" : "text-[#0d9488]";
  return "text-[#93b0b4]";
}

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
  changes,
}: WellnessSectionProps) => {
  const dayMap = buildDayMap(dailyLogs);
  const dateRange = getDayRange(contextStartDate, contextEndDate);

  // Check if there's any wellness data at all
  const hasWellnessData = dailyLogs.some(
    (l) => l.mood != null || l.energy != null || l.sleep != null || l.stress != null || l.soreness != null
  );
  if (!hasWellnessData) return null;

  return (
    <div>
      <SectionLabel label="Wellness" />
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.05 }}
        className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
      >
        <div className="grid grid-cols-5 gap-4">
          {METRICS.map((metric) => {
            const values = dateRange.map((day) => {
              const log = dayMap.get(day.date);
              return log?.[metric.key] ?? null;
            });

            // Divided by the days this metric was actually LOGGED, not by the
            // calendar days. An unlogged day is unknown, not zero: summing two
            // stress entries and dividing by seven reported 1.9 — "relaxed" — for
            // a client averaging 6.7, while the AI summary beside it, reading the
            // stored snapshot, correctly called the same week high-stress.
            // `calculateMetricAverages` (which writes that snapshot) has always
            // divided by its own per-metric count; this card was the only place
            // that did not. Per metric, not per card: stress and mood can be
            // logged on different days.
            const validValues = values.filter((v): v is number => v !== null);
            const avg =
              validValues.length > 0
                ? (validValues.reduce((a, b) => a + b, 0) / validValues.length).toFixed(1)
                : "--";

            const barData = dateRange.map((day) => ({
              value: dayMap.get(day.date)?.[metric.key] ?? null,
              dayLabel: day.dayLabel,
            }));

            // The delta comes from the STORED per-check-in snapshot while the
            // value above it averages this period's daily logs. They agree by
            // construction — `calculateMetricAverages` writes that snapshot with
            // the same per-metric denominator — but drift if a wellness log
            // lands after the check-in was submitted.
            const change = changes?.[metric.key];
            const hasDelta = change?.change !== undefined && change.previous !== undefined;

            return (
              <div key={metric.key} className="text-center">
                <div className="text-xs font-medium text-[#93b0b4] mb-2">
                  {metric.label}
                </div>
                <div className={cn("text-2xl font-bold tracking-tight", MONO, TEXT_PRIMARY)}>
                  {avg}
                </div>
                <div className="text-[11px] text-[#93b0b4]">
                  {metric.scale}
                </div>
                {hasDelta && (
                  <div
                    className={cn(
                      "text-[11px] font-medium",
                      MONO,
                      deltaClass(change, !!metric.inverse)
                    )}
                  >
                    {change.change! > 0 ? "+" : ""}
                    {change.change}
                  </div>
                )}
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
    </div>
  );
};
