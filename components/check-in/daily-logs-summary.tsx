"use client";

import { useMemo } from "react";
import type { DailyLog } from "@/types/daily-log";

type DailyLogsSummaryProps = {
  dailyLogs: DailyLog[];
  startDate?: string;
  endDate?: string;
};

type MetricAverages = {
  mood: number;
  energy: number;
  sleep: number;
  stress: number;
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

export const DailyLogsSummary = ({ dailyLogs }: DailyLogsSummaryProps) => {
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
      mood: acc.mood + (log.mood || 0),
      energy: acc.energy + (log.energy || 0),
      sleep: acc.sleep + (log.sleep || 0),
      stress: acc.stress + (log.stress || 0),
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
  
  // Sort logs by date for display
  const sortedLogs = useMemo(() => 
    [...dailyLogs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [dailyLogs]
  );
  
  return (
    <div className="space-y-6">
      {/* Trend Visualization */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-muted-foreground">Week at a Glance</h4>
        
        {/* Day indicators with color coding */}
        <div className="grid grid-cols-7 gap-2">
          {sortedLogs.map((log) => {
            const avgScore = ((log.mood || 0) + ((log.energy || 0) / 2) + ((log.sleep || 0) / 2) - ((log.stress || 0) / 2)) / 2.5;
            const colorClass = avgScore >= 3.5 ? "bg-success" : avgScore >= 2.5 ? "bg-warning" : "bg-destructive";
            
            return (
              <div key={log.date} className="text-center">
                <div className="text-xs text-muted-foreground mb-1">
                  {new Date(log.date).toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div className={`h-8 rounded ${colorClass} opacity-80`} />
                <div className="text-xs mt-1">
                  {new Date(log.date).getDate()}
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
        Based on {dailyLogs.length} days of data
        {sortedLogs.length > 0 && (
          <span className="block">
            {formatDate(sortedLogs[0].date)} - {formatDate(sortedLogs[sortedLogs.length - 1].date)}
          </span>
        )}
      </div>
    </div>
  );
};

export const calculateMetricAverages = (dailyLogs: DailyLog[]): MetricAverages => {
  const validLogs = dailyLogs.filter(log => 
    log.mood !== undefined || 
    log.energy !== undefined || 
    log.sleep !== undefined || 
    log.stress !== undefined
  );
  
  if (validLogs.length === 0) {
    return { mood: 3, energy: 5, sleep: 5, stress: 5 };
  }
  
  const sums = validLogs.reduce((acc, log) => ({
    mood: acc.mood + (log.mood || 0),
    energy: acc.energy + (log.energy || 0),
    sleep: acc.sleep + (log.sleep || 0),
    stress: acc.stress + (log.stress || 0),
    moodCount: acc.moodCount + (log.mood !== undefined ? 1 : 0),
    energyCount: acc.energyCount + (log.energy !== undefined ? 1 : 0),
    sleepCount: acc.sleepCount + (log.sleep !== undefined ? 1 : 0),
    stressCount: acc.stressCount + (log.stress !== undefined ? 1 : 0),
  }), {
    mood: 0, energy: 0, sleep: 0, stress: 0,
    moodCount: 0, energyCount: 0, sleepCount: 0, stressCount: 0
  });
  
  return {
    mood: sums.moodCount > 0 ? Math.round(sums.mood / sums.moodCount) : 3,
    energy: sums.energyCount > 0 ? Math.round(sums.energy / sums.energyCount) : 5,
    sleep: sums.sleepCount > 0 ? Math.round(sums.sleep / sums.sleepCount) : 5,
    stress: sums.stressCount > 0 ? Math.round(sums.stress / sums.stressCount) : 5,
  };
};