"use client";

import { useEffect, useState, useCallback } from "react";
import type { CheckIn, GetCheckInComparisonResponse } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";

export type FullWeekTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

type CheckInWithClient = {
  checkIn: CheckIn;
  client: {
    id: string;
    name: string;
    email?: string;
    avatar_url?: string;
  } | null;
};

type UseCheckInDetailDataProps = {
  checkInId: string | null;
  clientId: string;
  onClose: () => void;
  onNavigate?: (direction: "prev" | "next") => void;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
};

export function useCheckInDetailData({
  checkInId,
  clientId,
  onClose,
  onNavigate,
  canNavigatePrev,
  canNavigateNext,
}: UseCheckInDetailDataProps) {
  const [data, setData] = useState<CheckInWithClient | null>(null);
  const [comparisonData, setComparisonData] = useState<GetCheckInComparisonResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingComparison, setIsLoadingComparison] = useState(false);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLogWithDetails[]>([]);
  const [dailyContextLoading, setDailyContextLoading] = useState(false);
  const [contextStartDate, setContextStartDate] = useState<Date | null>(null);
  const [contextEndDate, setContextEndDate] = useState<Date | null>(null);
  const [fullWeekTarget, setFullWeekTarget] = useState<FullWeekTarget | null>(null);

  // Fetch check-in + comparison data
  useEffect(() => {
    if (!checkInId) {
      setData(null);
      setComparisonData(null);
      return;
    }

    const fetchCheckIn = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/check-in/${checkInId}`);
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (error) {
        console.error("Error fetching check-in:", error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    const fetchComparison = async () => {
      setIsLoadingComparison(true);
      try {
        const response = await fetch(`/api/check-in/${checkInId}/comparison`);
        if (response.ok) {
          const result = await response.json();
          setComparisonData(result);
        }
      } catch (error) {
        console.error("Error fetching comparison:", error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsLoadingComparison(false);
      }
    };

    fetchCheckIn();
    fetchComparison();
  }, [checkInId]);

  // Fetch daily context when check-in data is available
  useEffect(() => {
    if (!data?.checkIn || !clientId) {
      setDailyLogs([]);
      setHabitLogs([]);
      setContextStartDate(null);
      setContextEndDate(null);
      setFullWeekTarget(null);
      return;
    }

    const fetchDailyContext = async () => {
      setDailyContextLoading(true);
      try {
        const currentCheckIn = data.checkIn;
        let startDate: Date;
        let endDate: Date;

        if (currentCheckIn.periodStart && currentCheckIn.periodEnd) {
          startDate = new Date(currentCheckIn.periodStart + "T00:00:00");
          endDate = new Date(currentCheckIn.periodEnd + "T00:00:00");
        } else {
          endDate = new Date(currentCheckIn.createdAt);
          startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 6);
        }

        setContextStartDate(startDate);
        setContextEndDate(endDate);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        const [logsResponse, habitsResponse] = await Promise.all([
          fetch(
            `/api/clients/${clientId}/daily-logs?startDate=${startDateStr}&endDate=${endDateStr}`,
            { cache: 'no-store' }
          ),
          fetch(
            `/api/clients/${clientId}/habits/logs?startDate=${startDateStr}&endDate=${endDateStr}`,
            { cache: 'no-store' }
          ),
        ]);

        let fetchedLogs: DailyLog[] = [];
        if (logsResponse.ok) {
          const logsData = await logsResponse.json();
          fetchedLogs = logsData.data || [];
          setDailyLogs(fetchedLogs);
        }

        if (habitsResponse.ok) {
          const habitsData = await habitsResponse.json();
          setHabitLogs(habitsData.data || []);
        }

        // Compute full-week target
        try {
          const loggedDates = new Set(fetchedLogs.map((l: DailyLog) => l.date));
          const allDates: string[] = [];
          const cursor = new Date(startDate);
          while (cursor <= endDate) {
            allDates.push(cursor.toISOString().split("T")[0]);
            cursor.setDate(cursor.getDate() + 1);
          }
          const unloggedDates = allDates.filter((d) => !loggedDates.has(d));

          let totalCal = fetchedLogs.reduce((sum: number, l: DailyLog) => sum + (l.targetCalories ?? 0), 0);
          let totalProtein = fetchedLogs.reduce((sum: number, l: DailyLog) => sum + (l.targetProteinG ?? 0), 0);
          let totalCarbs = fetchedLogs.reduce((sum: number, l: DailyLog) => sum + (l.targetCarbsG ?? 0), 0);
          let totalFat = fetchedLogs.reduce((sum: number, l: DailyLog) => sum + (l.targetFatG ?? 0), 0);

          if (unloggedDates.length > 0) {
            const planTargetResponse = await fetch(
              `/api/clients/${clientId}/nutrition/plan-targets?dates=${unloggedDates.join(",")}`,
              { cache: "no-store" }
            );
            if (planTargetResponse.ok) {
              const planTargetData = await planTargetResponse.json();
              const targets = planTargetData.targets || [];
              for (const pt of targets) {
                totalCal += pt.calories ?? 0;
                totalProtein += pt.proteinG ?? 0;
                totalCarbs += pt.carbsG ?? 0;
                totalFat += pt.fatG ?? 0;
              }
            }
          }

          setFullWeekTarget({
            calories: totalCal,
            proteinG: totalProtein,
            carbsG: totalCarbs,
            fatG: totalFat,
          });
        } catch {
          setFullWeekTarget(null);
        }
      } catch (error) {
        console.error('Error fetching daily context:', error instanceof Error ? error.message : "Unknown error");
      } finally {
        setDailyContextLoading(false);
      }
    };

    fetchDailyContext();
  }, [data?.checkIn?.id, checkInId, clientId]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!checkInId) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && canNavigatePrev && onNavigate) {
        onNavigate("prev");
      } else if (e.key === "ArrowRight" && canNavigateNext && onNavigate) {
        onNavigate("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkInId, canNavigatePrev, canNavigateNext, onNavigate, onClose]);

  const handleResponseSent = useCallback(() => {
    if (checkInId) {
      fetch(`/api/check-in/${checkInId}`)
        .then((res) => res.json())
        .then((result) => setData(result));
    }
  }, [checkInId]);

  return {
    data,
    comparisonData,
    isLoading,
    isLoadingComparison,
    dailyLogs,
    habitLogs,
    dailyContextLoading,
    contextStartDate,
    contextEndDate,
    fullWeekTarget,
    handleResponseSent,
  };
}

export function formatDateRange(start: Date, end: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `Week of ${months[start.getMonth()]} ${start.getDate()} \u2013 ${end.getDate()}, ${end.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `Week of ${months[start.getMonth()]} ${start.getDate()} \u2013 ${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `Week of ${months[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} \u2013 ${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

export function formatSubmittedDate(dateStr: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(dateStr);
  return `Submitted ${months[d.getMonth()]} ${d.getDate()}`;
}
