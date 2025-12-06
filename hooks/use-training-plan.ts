"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { TrainingPlan, PreGenerationActivity } from "@/types/training";

type UseTrainingPlanProps = {
  clientId: string;
  onUpdate?: () => void;
};

export function useTrainingPlan({ clientId, onUpdate }: UseTrainingPlanProps) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preGenerationActivities, setPreGenerationActivities] = useState<PreGenerationActivity[]>([]);
  const [allowSameDayTraining, setAllowSameDayTraining] = useState(false);

  const fetchPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/training`);
      const data = await res.json();
      if (data.success) {
        setPlan(data.plan || null);
      }
    } catch (error) {
      console.error("Failed to fetch training plan:", error);
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const handleGenerate = async () => {
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
        }),
      });

      const data = await res.json();

      if (data.success && data.plan) {
        setPlan(data.plan);
        setPrompt("");
        setPreGenerationActivities([]);
        setAllowSameDayTraining(false);
        toast({ title: "Training plan generated", description: data.plan.name });
        onUpdate?.();
        return true;
      } else {
        throw new Error(data.error || "Failed to generate plan");
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

  const handleAddPreGenActivity = (activity: PreGenerationActivity) => {
    setPreGenerationActivities((prev) => [...prev, activity]);
  };

  const handleRemovePreGenActivity = (tempId: string) => {
    setPreGenerationActivities((prev) => prev.filter((a) => a.tempId !== tempId));
  };

  const trainingSessions = plan?.sessions.filter((s) => s.sessionType !== "external_activity") ?? [];
  const externalActivities = plan?.sessions.filter((s) => s.sessionType === "external_activity") ?? [];

  return {
    plan,
    isLoading,
    isGenerating,
    prompt,
    setPrompt,
    preGenerationActivities,
    setPreGenerationActivities,
    allowSameDayTraining,
    setAllowSameDayTraining,
    handleGenerate,
    handleAddPreGenActivity,
    handleRemovePreGenActivity,
    fetchPlan,
    trainingSessions,
    externalActivities,
  };
}
