import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { getTodayDateString } from "@/lib/date-helpers";
import { fetchWithRetry, fetchWeeklyLogs } from "./use-daily-pulse-helpers";
import type { TrainingPlan, TrainingSession } from "@/types/training";
import type { DailyLog } from "@/types/daily-log";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import type { TodaysActivity } from "@/types/daily-pulse";

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

interface UseDailyPulseReturn {
  todayLog: DailyLog | null;
  streak: number;
  nutritionTarget: DailyNutritionTargets | null;
  todaysTrainingSession: TrainingSession | null;
  plannedActivities: TodaysActivity[];
  allTrainingSessions: TrainingSession[];
  habits: DailyHabit[];
  habitLogs: HabitLogWithDetails[];
  weeklyLogs: Pick<DailyLog, "date" | "id">[];
  weeklyNutritionSummary: WeeklyNutritionSummary | null;
  isLoading: boolean;
  isSaving: boolean;
  saveLog: (data: {
    mood?: number;
    energy?: number;
    sleep?: number;
    stress?: number;
    notes?: string;
    trained?: boolean;
    trainingSessionId?: string;
    trainingData?: DailyLog['trainingData'];
    caloriesConsumed?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
  }) => Promise<void>;
  updateWeeklyLogs: (date: string) => void;
}

export function useDailyPulse(selectedDate: string): UseDailyPulseReturn {
  const { toast } = useToast();
  const [todayLog, setTodayLog] = useState<DailyLog | null>(null);
  const [streak, setStreak] = useState(0);
  const [nutritionTarget, setNutritionTarget] = useState<DailyNutritionTargets | null>(null);
  const [todaysTrainingSession, setTodaysTrainingSession] = useState<TrainingSession | null>(null);
  const [plannedActivities, setPlannedActivities] = useState<TodaysActivity[]>([]);
  const [allTrainingSessions, setAllTrainingSessions] = useState<TrainingSession[]>([]);
  const [habits, setHabits] = useState<DailyHabit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLogWithDetails[]>([]);
  const [weeklyLogs, setWeeklyLogs] = useState<Pick<DailyLog, "date" | "id">[]>([]);
  const [weeklyNutritionSummary, setWeeklyNutritionSummary] = useState<WeeklyNutritionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch weekly logs on mount
  useEffect(() => {
    const loadWeeklyLogs = async () => {
      const today = getTodayDateString();
      const logs = await fetchWeeklyLogs(today);
      setWeeklyLogs(logs);
    };
    loadWeeklyLogs();
  }, []);

  // Fetch data for selected date
  useEffect(() => {
    // Cancel previous request if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoading(true);
    
    const fetchData = async () => {
      try {
        const dateParam = `?date=${selectedDate}`;
        
        const [logRes, streakRes, nutritionRes, trainingRes, habitsRes, habitLogsRes, weeklyNutritionRes] = await Promise.all([
          fetchWithRetry(`/api/client/daily-logs/today${dateParam}`, { 
            cache: 'no-store',
            signal: controller.signal 
          }),
          fetchWithRetry("/api/client/daily-logs/streak", { 
            cache: 'no-store',
            signal: controller.signal 
          }),
          fetchWithRetry(`/api/client/daily-logs/nutrition-target${dateParam}`, { 
            cache: 'no-store',
            signal: controller.signal 
          }),
          fetchWithRetry("/api/client/training", { 
            cache: 'no-store',
            signal: controller.signal 
          }),
          fetchWithRetry("/api/client/habits", { 
            cache: 'no-store',
            signal: controller.signal 
          }),
          fetchWithRetry(`/api/client/habits/logs/today${dateParam}`, {
            cache: 'no-store',
            signal: controller.signal
          }),
          fetchWithRetry("/api/client/weekly-nutrition?latest=true", {
            cache: 'no-store',
            signal: controller.signal
          }),
        ]);

        if (logRes.ok) {
          const logData = await logRes.json();
          setTodayLog(logData.data);
          
          // Update weekly logs to reflect this day's log status
          if (logData.data) {
            setWeeklyLogs(prev => {
              const exists = prev.some(log => log.date === selectedDate);
              if (!exists) {
                return [...prev, { date: selectedDate, id: logData.data.id }].sort((a, b) => a.date.localeCompare(b.date));
              }
              return prev;
            });
          }
        }

        if (streakRes.ok) {
          const streakData = await streakRes.json();
          setStreak(streakData.data?.currentStreak ?? 0);
        }

        let nutritionData: { data?: { nutritionTarget?: DailyNutritionTargets; trainingSession?: { sessionId: string; sessionName: string; estimatedCalories: number } | null; plannedActivities?: TodaysActivity[] } } | null = null;
        if (nutritionRes.ok) {
          nutritionData = await nutritionRes.json();
          if (nutritionData?.data) {
            setNutritionTarget(nutritionData.data.nutritionTarget || null);
            setTodaysTrainingSession(null);
            setPlannedActivities(nutritionData.data.plannedActivities || []);
          }
        }

        if (trainingRes.ok) {
          const trainingData = await trainingRes.json();
          if (trainingData.data) {
            const trainingSessions = (trainingData.data as TrainingPlan).sessions;
            setAllTrainingSessions(trainingSessions);
            
            // Enrich with full session data (exercises, etc.) but preserve the
            // event-based estimatedCalories — the template session value may be
            // stale legacy data from before training events existed.
            if (nutritionData?.data?.trainingSession) {
              const eventCalories = nutritionData.data.trainingSession.estimatedCalories;
              const fullSession = trainingSessions.find(
                (s: TrainingSession) => s.id === nutritionData.data?.trainingSession?.sessionId
              );
              if (fullSession) {
                setTodaysTrainingSession({
                  ...fullSession,
                  estimatedCalories: eventCalories ?? fullSession.estimatedCalories,
                });
              }
            }
          }
        }

        if (habitsRes.ok) {
          const habitsData = await habitsRes.json();
          setHabits(habitsData.data || []);
        }

        if (habitLogsRes.ok) {
          const habitLogsData = await habitLogsRes.json();
          setHabitLogs(habitLogsData.data || []);
        }

        if (weeklyNutritionRes.ok) {
          const weeklyNutritionData = await weeklyNutritionRes.json();
          setWeeklyNutritionSummary(weeklyNutritionData.data || null);
        }

        // Successfully fetched data
        setIsLoading(false);

      } catch (error) {
        // Don't show error if the request was aborted (user navigated away)
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        
        // Error already handled by not showing data
        toast({
          title: "Error",
          description: "Failed to load daily pulse data",
          variant: "destructive",
        });
        setIsLoading(false);
      }
    };

    fetchData();
    
    // Cleanup function to abort requests when component unmounts or date changes
    return () => {
      controller.abort();
    };
  }, [selectedDate, toast]);


  const saveLog = async (data: {
    mood?: number;
    energy?: number;
    sleep?: number;
    stress?: number;
    notes?: string;
    trained?: boolean;
    trainingSessionId?: string;
    trainingData?: DailyLog['trainingData'];
    caloriesConsumed?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
  }) => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/client/daily-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date: selectedDate,
          ...data,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save daily log");
      }

      const result = await response.json();
      setTodayLog(result.data);
      
      // Update weekly logs to include this saved date
      if (result.data) {
        setWeeklyLogs(prev => {
          const exists = prev.some(log => log.date === selectedDate);
          if (!exists) {
            return [...prev, { date: selectedDate, id: result.data.id }].sort((a, b) => a.date.localeCompare(b.date));
          }
          return prev;
        });
      }

      toast({
        title: "Success",
        description: todayLog ? "Daily log updated" : "Daily log saved",
      });

      // Refetch streak in case it changed
      const streakRes = await fetchWithRetry("/api/client/daily-logs/streak", { cache: 'no-store' });
      if (streakRes.ok) {
        const streakData = await streakRes.json();
        setStreak(streakData.data?.currentStreak || 0);
      }
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to save daily log",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to update weekly logs optimistically
  const updateWeeklyLogs = (date: string) => {
    setWeeklyLogs(prev => {
      // Check if log already exists for this date
      const exists = prev.some(log => log.date === date);
      if (exists) return prev;
      
      // Add new log entry
      return [...prev, { date, id: `temp-${date}` }].sort((a, b) => a.date.localeCompare(b.date));
    });
  };

  return {
    todayLog,
    streak,
    nutritionTarget,
    todaysTrainingSession,
    plannedActivities,
    allTrainingSessions,
    habits,
    habitLogs,
    weeklyLogs,
    weeklyNutritionSummary,
    isLoading,
    isSaving,
    saveLog,
    updateWeeklyLogs,
  };
}