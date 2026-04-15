"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { TrainingPlan, PreGenerationActivity } from "@/types/training";
import { parseGetPlanResponse, parseGeneratePlanResponse } from "@/lib/validations/training";
import type { UpcomingTrainingPlan } from "@/lib/validations/training";

type UseTrainingPlanProps = {
  clientId: string;
  onUpdate?: () => void;
};

export function useTrainingPlan({ clientId, onUpdate }: UseTrainingPlanProps) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [upcomingPlan, setUpcomingPlan] = useState<UpcomingTrainingPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [preGenerationActivities, setPreGenerationActivities] = useState<PreGenerationActivity[]>([]);
  const [allowSameDayTraining, setAllowSameDayTraining] = useState(false);
  const [phaseId, setPhaseId] = useState<string | undefined>(undefined);
  const [phaseBlocked, setPhaseBlocked] = useState(false);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/training`);
      if (!res.ok) {
        throw new Error(`Failed to fetch plan: ${res.status}`);
      }
      const rawData = await res.json();
      const data = parseGetPlanResponse(rawData);
      if (!data) {
        console.error("Invalid API response structure:", rawData);
        throw new Error("Invalid response from server");
      }
      if (data.success) {
        setPlan(data.plan || null);
        setUpcomingPlan((data.upcomingPlan as UpcomingTrainingPlan) || null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load training plan";
      console.error("Failed to fetch training plan:", error);
      setLoadError(errorMessage);
      toast({
        title: "Error loading plan",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [clientId, toast]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const generate = async (effectiveFrom?: string | null) => {
    if (!prompt.trim() || prompt.length < 10) {
      toast({
        title: "Please provide more detail",
        description: "Describe the client's goals, preferences, and any constraints",
        variant: "destructive",
      });
      return false;
    }

    // Filter to only valid activities (safety net for validation)
    const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const validActivities = preGenerationActivities.filter((a) => {
      const hasValidName = a.activityName && a.activityName.trim().length > 0;
      const hasValidDay = a.dayOfWeek && validDays.includes(a.dayOfWeek.toLowerCase());
      return hasValidName && hasValidDay;
    });

    setIsGenerating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachPrompt: prompt,
          preGenerationActivities: validActivities.length > 0 ? validActivities : undefined,
          allowSameDayTraining,
          phaseId: phaseId || undefined,
          effectiveFrom: effectiveFrom ?? undefined,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }

      const rawData = await res.json();
      const data = parseGeneratePlanResponse(rawData);

      if (!data) {
        console.error("Invalid API response structure:", rawData);
        throw new Error("Invalid response from server");
      }

      if (data.success && data.savedPlanId) {
        setSavedPlanId(data.savedPlanId);
        setPrompt("");
        setPreGenerationActivities([]);
        setAllowSameDayTraining(false);
        setPhaseId(undefined);
        toast({ title: "Plan draft created" });
        return true;
      } else {
        throw new Error(data.error || data.errorMessage || "Failed to generate plan");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate plan",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  const addPreGenActivity = (activity: PreGenerationActivity) => {
    setPreGenerationActivities((prev) => [...prev, activity]);
  };

  const removePreGenActivity = (tempId: string) => {
    setPreGenerationActivities((prev) => prev.filter((a) => a.tempId !== tempId));
  };

  const trainingSessions = plan?.sessions.filter((s) => s.sessionType !== "external_activity") ?? [];
  const externalActivities = plan?.sessions.filter((s) => s.sessionType === "external_activity") ?? [];

  return {
    clientId,
    plan,
    upcomingPlan,
    isLoading,
    isGenerating,
    loadError,
    prompt,
    setPrompt,
    preGenerationActivities,
    setPreGenerationActivities,
    allowSameDayTraining,
    setAllowSameDayTraining,
    phaseId,
    setPhaseId,
    phaseBlocked,
    setPhaseBlocked,
    savedPlanId,
    setSavedPlanId,
    generate,
    addPreGenActivity,
    removePreGenActivity,
    fetchPlan,
    trainingSessions,
    externalActivities,
  };
}
