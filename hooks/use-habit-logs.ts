import { useMemo } from "react";
import useSWR from "swr";
import type { HabitLogWithDetails } from "@/types/daily-habit";

export type DateRangeFilter = "7d" | "30d" | "90d" | "all";

interface ChartDataPoint {
  date: string;
  value: number;
  completed: boolean;
}

interface HabitChartData {
  habitId: string;
  habitName: string;
  isBoolean: boolean;
  targetValue?: number;
  targetUnit?: string;
  data: ChartDataPoint[];
}

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch");
  }
  const data = await response.json();
  return data.data;
};

const getDateRange = (filter: DateRangeFilter): { startDate: string; endDate: string } => {
  const endDate = new Date();
  const startDate = new Date();
  
  switch (filter) {
    case "7d":
      startDate.setDate(endDate.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(endDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(endDate.getDate() - 90);
      break;
    case "all":
      startDate.setFullYear(endDate.getFullYear() - 5);
      break;
  }
  
  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
};

const generateDateRange = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  
  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
};

export function useHabitLogs(clientId: string | null, dateRange: DateRangeFilter = "30d") {
  const { startDate, endDate } = getDateRange(dateRange);
  
  const {
    data: logs,
    error,
    isLoading,
    mutate,
  } = useSWR<HabitLogWithDetails[]>(
    clientId
      ? `/api/clients/${clientId}/habits/logs?startDate=${startDate}&endDate=${endDate}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      shouldRetryOnError: true,
      dedupingInterval: 2000,
      onError: (err) => {
        console.error('habit-logs fetch error:', err);
        console.error('Failed URL:', `/api/clients/${clientId}/habits/logs?startDate=${startDate}&endDate=${endDate}`);
      }
    }
  );
  
  const chartData = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    
    const habitMap = new Map<string, HabitChartData>();
    const dateRange = generateDateRange(startDate, endDate);
    
    logs.forEach((log) => {
      if (!habitMap.has(log.dailyHabitId)) {
        habitMap.set(log.dailyHabitId, {
          habitId: log.dailyHabitId,
          habitName: log.habitName,
          isBoolean: log.isBoolean,
          targetValue: log.targetValue,
          targetUnit: log.targetUnit,
          data: dateRange.map((date) => ({
            date,
            value: 0,
            completed: false,
          })),
        });
      }
      
      const habitData = habitMap.get(log.dailyHabitId);
      if (habitData) {
        const dataPoint = habitData.data.find((d) => d.date === log.date);
        if (dataPoint) {
          dataPoint.completed = log.completed;
          dataPoint.value = log.completed ? 1 : 0;
        }
      }
    });
    
    return Array.from(habitMap.values());
  }, [logs, startDate, endDate]);
  
  const getHabitChartData = (habitId: string): ChartDataPoint[] => {
    const habitData = chartData.find((h) => h.habitId === habitId);
    return habitData?.data ?? [];
  };
  
  const getHabitInfo = (habitId: string) => {
    const habitData = chartData.find((h) => h.habitId === habitId);
    if (!habitData) return null;
    
    return {
      isBoolean: habitData.isBoolean,
      targetValue: habitData.targetValue,
      targetUnit: habitData.targetUnit,
    };
  };
  
  const calculateAverageValue = (habitId: string): number | null => {
    const habitData = chartData.find((h) => h.habitId === habitId);
    if (!habitData || habitData.isBoolean) return null;
    
    const completedData = habitData.data.filter((d) => d.completed);
    if (completedData.length === 0) return null;
    
    const sum = completedData.reduce((acc, d) => acc + d.value, 0);
    return Math.round((sum / completedData.length) * 10) / 10;
  };
  
  const calculateCompletionRate = (habitId: string, days: number): number => {
    const habitData = chartData.find((h) => h.habitId === habitId);
    if (!habitData) return 0;
    
    const recentData = habitData.data.slice(-days);
    const completed = recentData.filter((d) => d.completed).length;
    
    return Math.round((completed / recentData.length) * 100);
  };
  
  return {
    logs,
    chartData,
    isLoading,
    error,
    refetch: mutate,
    getHabitChartData,
    getHabitInfo,
    calculateAverageValue,
    calculateCompletionRate,
  };
}