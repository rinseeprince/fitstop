import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { getTodayDateString } from "@/lib/date-helpers";
import type { TrainingPlan, TrainingSession } from "@/types/training";
import type { DailyLog } from "@/types/daily-log";

type NutritionTarget = {
  day: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isRestDay: boolean;
  isLowDay: boolean;
  isHighDay: boolean;
  notes?: string | null;
};

type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
};


interface UseDailyPulseReturn {
  todayLog: DailyLog | null;
  streak: number;
  nutritionTarget: NutritionTarget | null;
  todaysTrainingSession: TrainingSession | null;
  plannedActivities: TodaysActivity[];
  allTrainingSessions: TrainingSession[];
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
  }) => Promise<void>;
}

export function useDailyPulse(): UseDailyPulseReturn {
  const { toast } = useToast();
  const [todayLog, setTodayLog] = useState<DailyLog | null>(null);
  const [streak, setStreak] = useState(0);
  const [nutritionTarget, setNutritionTarget] = useState<NutritionTarget | null>(null);
  const [todaysTrainingSession, setTodaysTrainingSession] = useState<TrainingSession | null>(null);
  const [plannedActivities, setPlannedActivities] = useState<TodaysActivity[]>([]);
  const [allTrainingSessions, setAllTrainingSessions] = useState<TrainingSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [logRes, streakRes, nutritionRes, trainingRes] = await Promise.all([
          fetch("/api/client/daily-logs/today", { cache: 'no-store' }),
          fetch("/api/client/daily-logs/streak", { cache: 'no-store' }),
          fetch("/api/client/daily-logs/nutrition-target", { cache: 'no-store' }),
          fetch("/api/client/training", { cache: 'no-store' }),
        ]);

        if (logRes.ok) {
          const logData = await logRes.json();
          setTodayLog(logData.data);
        }

        if (streakRes.ok) {
          const streakData = await streakRes.json();
          setStreak(streakData.data?.currentStreak || 0);
        }

        let nutritionData: any = null;
        if (nutritionRes.ok) {
          nutritionData = await nutritionRes.json();
          if (nutritionData.data) {
            setNutritionTarget(nutritionData.data.nutritionTarget);
            setTodaysTrainingSession(null);
            setPlannedActivities(nutritionData.data.plannedActivities || []);
          }
        }

        if (trainingRes.ok) {
          const trainingData = await trainingRes.json();
          if (trainingData.data) {
            const trainingSessions = (trainingData.data as TrainingPlan).sessions
              .filter((s: TrainingSession) => s.sessionType === "training");
            setAllTrainingSessions(trainingSessions);
            
            // Update todaysTrainingSession with full session data if we have the ID
            if (nutritionData?.data?.trainingSession) {
              const fullSession = trainingSessions.find(
                (s: TrainingSession) => s.id === nutritionData.data.trainingSession.sessionId
              );
              if (fullSession) {
                setTodaysTrainingSession(fullSession);
              }
            }
          }
        }

      } catch (error) {
        console.error("Error fetching daily pulse data:", error);
        toast({
          title: "Error",
          description: "Failed to load daily pulse data",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [toast]);


  const saveLog = async (data: {
    mood?: number;
    energy?: number;
    sleep?: number;
    stress?: number;
    notes?: string;
    trained?: boolean;
    trainingSessionId?: string;
    trainingData?: DailyLog['trainingData'];
  }) => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/client/daily-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date: getTodayDateString(),
          ...data,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save daily log");
      }

      const result = await response.json();
      setTodayLog(result.data);

      toast({
        title: "Success",
        description: todayLog ? "Daily log updated" : "Daily log saved",
      });

      // Refetch streak in case it changed
      const streakRes = await fetch("/api/client/daily-logs/streak", { cache: 'no-store' });
      if (streakRes.ok) {
        const streakData = await streakRes.json();
        setStreak(streakData.data?.currentStreak || 0);
      }
    } catch (error) {
      console.error("Error saving daily log:", error);
      toast({
        title: "Error",
        description: "Failed to save daily log",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    todayLog,
    streak,
    nutritionTarget,
    todaysTrainingSession,
    plannedActivities,
    allTrainingSessions,
    isLoading,
    isSaving,
    saveLog,
  };
}