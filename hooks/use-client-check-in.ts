"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import type {
  CheckInFormData,
  CheckInClientInfo,
  CheckInTrainingContext,
  CheckInNutritionContext,
} from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type CheckInContextData = {
  clientInfo: CheckInClientInfo;
  trainingContext?: CheckInTrainingContext;
  nutritionContext?: CheckInNutritionContext;
  dailyLogs?: DailyLog[];
};

export function useClientCheckIn() {
  const { user } = useAuth();
  const [contextData, setContextData] = useState<CheckInContextData | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  // Fetch check-in context on mount
  useEffect(() => {
    if (!user) {
      setIsLoadingContext(false);
      return;
    }

    const fetchContext = async () => {
      try {
        setIsLoadingContext(true);
        setContextError(null);

        const response = await fetch("/api/client/check-in-context");
        const result = await response.json();

        if (!response.ok || !result.success) {
          // Surface specific gating error codes so the page can show friendly messages
          if (result.error === "not_due" || result.error === "completed") {
            setContextError(result.error);
            return;
          }
          throw new Error(result.error || "Failed to fetch check-in context");
        }

        setContextData(result.data);
      } catch (error) {
        setContextError(error instanceof Error ? error.message : "Failed to load context");
      } finally {
        setIsLoadingContext(false);
      }
    };

    fetchContext();
  }, [user]);

  // Submit check-in function
  const submitCheckIn = async (formData: CheckInFormData): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      const response = await fetch("/api/client/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return {
          success: false,
          error: result.error || "Failed to submit check-in",
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to submit check-in",
      };
    }
  };

  return {
    contextData,
    isLoadingContext,
    contextError,
    submitCheckIn,
  };
}