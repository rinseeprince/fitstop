import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { getTodayDateString } from "@/lib/date-helpers";
import type { Database } from "@/types/database";

type DailyLog = Database["public"]["Tables"]["daily_logs"]["Row"];

interface UseDailyPulseReturn {
  todayLog: DailyLog | null;
  streak: number;
  isLoading: boolean;
  isSaving: boolean;
  saveLog: (data: {
    mood?: number;
    energy?: number;
    sleep?: number;
    stress?: number;
    notes?: string;
  }) => Promise<void>;
}

export function useDailyPulse(): UseDailyPulseReturn {
  const { toast } = useToast();
  const [todayLog, setTodayLog] = useState<DailyLog | null>(null);
  const [streak, setStreak] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [logRes, streakRes] = await Promise.all([
          fetch("/api/client/daily-logs/today"),
          fetch("/api/client/daily-logs/streak"),
        ]);

        if (logRes.ok) {
          const logData = await logRes.json();
          setTodayLog(logData.data);
        }

        if (streakRes.ok) {
          const streakData = await streakRes.json();
          setStreak(streakData.data?.currentStreak || 0);
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
      const streakRes = await fetch("/api/client/daily-logs/streak");
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
    isLoading,
    isSaving,
    saveLog,
  };
}