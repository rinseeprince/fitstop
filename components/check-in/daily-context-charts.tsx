"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import type { DailyLog } from "@/types/daily-log";
import { getBarColor, type WellnessMetric } from "@/utils/wellness-color-thresholds";

interface DailyContextChartsProps {
  dailyLogs: DailyLog[];
  startDate: Date;
  endDate: Date;
}

export const DailyContextCharts = ({ 
  dailyLogs, 
  startDate, 
  endDate 
}: DailyContextChartsProps) => {
  // Build complete date range with nulls for missing days
  const buildChartData = (metric: WellnessMetric) => {
    const data = [];
    const logMap = new Map(
      dailyLogs.map(log => [log.date, log])
    );
    
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const log = logMap.get(dateStr);
      
      let value = null;
      if (log) {
        switch (metric) {
          case "mood": value = log.mood ?? null; break;
          case "energy": value = log.energy ?? null; break;
          case "sleep": value = log.sleep ?? null; break;
          case "stress": value = log.stress ?? null; break;
        }
      }
      
      data.push({
        date: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value,
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return data;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload[0]) return null;
    
    const value = payload[0].value;
    const date = payload[0].payload.date;
    
    return (
      <div className="bg-white border rounded p-1 text-xs shadow">
        <p className="text-gray-600">{date}</p>
        <p className="font-medium">
          {value !== null ? value : "No data"}
        </p>
      </div>
    );
  };

  const renderChart = (metric: WellnessMetric, label: string, maxValue: number) => {
    const data = buildChartData(metric);
    
    return (
      <div key={metric} className="flex-1">
        <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
        <div className="h-16">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis hide />
              <YAxis hide domain={[0, maxValue]} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent" }} />
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={getBarColor(metric, entry.value)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-4 mb-4">
      <div className="grid grid-cols-2 gap-2">
        {renderChart("mood", "Mood", 5)}
        {renderChart("energy", "Energy", 10)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderChart("sleep", "Sleep", 10)}
        {renderChart("stress", "Stress", 10)}
      </div>
    </div>
  );
};