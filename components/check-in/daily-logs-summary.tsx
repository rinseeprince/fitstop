"use client";

import { useMemo } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { DailyLog } from "@/types/daily-log";
import type { MetricAverages } from "@/utils/daily-logs-aggregation";

type DailyLogsSummaryProps = {
  dailyLogs: DailyLog[];
  periodStart?: string;
  periodEnd?: string;
};

const getMetricColor = (metric: "mood" | "energy" | "sleep" | "stress", value: number) => {
  if (metric === "mood") {
    if (value >= 4) return "bg-success";
    if (value >= 3) return "bg-warning";
    return "bg-destructive";
  }

  if (metric === "stress") {
    if (value <= 3) return "bg-success";
    if (value <= 6) return "bg-warning";
    return "bg-destructive";
  }

  // For energy and sleep (higher is better)
  if (value >= 7) return "bg-success";
  if (value >= 5) return "bg-warning";
  return "bg-destructive";
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

export const DailyLogsSummary = ({ dailyLogs, periodStart, periodEnd }: DailyLogsSummaryProps) => {
  const averages = useMemo<MetricAverages>(() => {
    const validLogs = dailyLogs.filter(log =>
      log.mood !== undefined ||
      log.energy !== undefined ||
      log.sleep !== undefined ||
      log.stress !== undefined
    );

    if (validLogs.length === 0) {
      return { mood: 0, energy: 0, sleep: 0, stress: 0 };
    }

    const sums = validLogs.reduce((acc, log) => ({
      mood: acc.mood + (log.mood ?? 0),
      energy: acc.energy + (log.energy ?? 0),
      sleep: acc.sleep + (log.sleep ?? 0),
      stress: acc.stress + (log.stress ?? 0),
      moodCount: acc.moodCount + (log.mood !== undefined ? 1 : 0),
      energyCount: acc.energyCount + (log.energy !== undefined ? 1 : 0),
      sleepCount: acc.sleepCount + (log.sleep !== undefined ? 1 : 0),
      stressCount: acc.stressCount + (log.stress !== undefined ? 1 : 0),
    }), {
      mood: 0, energy: 0, sleep: 0, stress: 0,
      moodCount: 0, energyCount: 0, sleepCount: 0, stressCount: 0
    });

    return {
      mood: sums.moodCount > 0 ? Number((sums.mood / sums.moodCount).toFixed(1)) : 0,
      energy: sums.energyCount > 0 ? Number((sums.energy / sums.energyCount).toFixed(1)) : 0,
      sleep: sums.sleepCount > 0 ? Number((sums.sleep / sums.sleepCount).toFixed(1)) : 0,
      stress: sums.stressCount > 0 ? Number((sums.stress / sums.stressCount).toFixed(1)) : 0,
    };
  }, [dailyLogs]);

  // Build a lookup of logged dates (has at least one wellness metric)
  const loggedDates = useMemo(() => {
    const set = new Set<string>();
    for (const log of dailyLogs) {
      if (
        log.mood !== undefined && log.mood !== null ||
        log.energy !== undefined && log.energy !== null ||
        log.sleep !== undefined && log.sleep !== null ||
        log.stress !== undefined && log.stress !== null
      ) {
        set.add(log.date);
      }
    }
    return set;
  }, [dailyLogs]);

  // Generate all dates in the period using local date parts (toISOString shifts to UTC, causing
  // duplicates around DST transitions like the March 29 BST spring-forward)
  const periodDays = useMemo(() => {
    if (!periodStart || !periodEnd) {
      const seen = new Set<string>();
      return [...dailyLogs]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .reduce<string[]>((acc, log) => {
          if (!seen.has(log.date)) {
            seen.add(log.date);
            acc.push(log.date);
          }
          return acc;
        }, []);
    }
    const days: string[] = [];
    const cursor = new Date(periodStart + "T12:00:00");
    const end = new Date(periodEnd + "T12:00:00");
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, "0");
      const d = String(cursor.getDate()).padStart(2, "0");
      days.push(`${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [periodStart, periodEnd, dailyLogs]);

  const loggedCount = periodDays.filter((d) => loggedDates.has(d)).length;

  return (
    <div className="space-y-6">
      {/* Week at a Glance */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-muted-foreground">Week at a Glance</h4>
          <span className="text-xs text-muted-foreground">
            {loggedCount}/{periodDays.length} days logged
          </span>
        </div>

        <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${periodDays.length}, 1fr)` }}>
          {periodDays.map((dateStr) => {
            const isLogged = loggedDates.has(dateStr);
            const date = new Date(dateStr + "T00:00:00");

            return (
              <div key={dateStr} className="text-center">
                <div className="text-xs text-muted-foreground mb-1">
                  {date.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div className="flex justify-center">
                  {isLogged ? (
                    <CheckCircle2 className="h-6 w-6 text-success" />
                  ) : (
                    <Circle className="h-6 w-6 text-muted-foreground/30" />
                  )}
                </div>
                <div className="text-xs mt-1">
                  {date.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Averages Display */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">Period Averages</h4>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm">Mood</span>
            <span className={`text-sm font-semibold px-2 py-1 rounded ${getMetricColor("mood", averages.mood)}`}>
              {averages.mood.toFixed(1)}/5
            </span>
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm">Energy</span>
            <span className={`text-sm font-semibold px-2 py-1 rounded ${getMetricColor("energy", averages.energy)}`}>
              {averages.energy.toFixed(1)}/10
            </span>
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm">Sleep</span>
            <span className={`text-sm font-semibold px-2 py-1 rounded ${getMetricColor("sleep", averages.sleep)}`}>
              {averages.sleep.toFixed(1)}/10
            </span>
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm">Stress</span>
            <span className={`text-sm font-semibold px-2 py-1 rounded ${getMetricColor("stress", averages.stress)}`}>
              {averages.stress.toFixed(1)}/10
            </span>
          </div>
        </div>
      </div>
      
      {/* Period Info */}
      <div className="text-xs text-muted-foreground text-center">
        Based on {loggedCount} days of data
        {periodDays.length > 0 && (
          <span className="block">
            {formatDate(periodDays[0])} - {formatDate(periodDays[periodDays.length - 1])}
          </span>
        )}
      </div>
    </div>
  );
};