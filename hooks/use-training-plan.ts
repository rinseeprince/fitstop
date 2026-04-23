"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { TrainingPlan } from "@/types/training";
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
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    setIsLoading(true);
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

  const generate = async (options: { planName?: string; effectiveFrom?: string | null } = {}) => {
    if (!prompt.trim() || prompt.length < 10) {
      toast({
        title: "Please provide more detail",
        description: "Describe the client's goals, preferences, and any constraints",
        variant: "destructive",
      });
      return false;
    }

    const trimmedName = options.planName?.trim();

    setIsGenerating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachPrompt: prompt,
          name: trimmedName || undefined,
          effectiveFrom: options.effectiveFrom ?? undefined,
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

  const trainingSessions = plan?.sessions ?? [];

  return {
    clientId,
    plan,
    upcomingPlan,
    isLoading,
    isGenerating,
    loadError,
    prompt,
    setPrompt,
    savedPlanId,
    setSavedPlanId,
    generate,
    fetchPlan,
    trainingSessions,
  };
}
