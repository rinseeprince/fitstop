"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { TrainingPlan } from "@/types/training";
import { parseGetPlanResponse } from "@/lib/validations/training";

type UseTrainingPlanProps = {
  clientId: string;
};

/**
 * Reads a client's active training plan for the coach-side Training tab.
 *
 * Read-only: authoring lives in the Programs builder (`ProgramDraftProvider`),
 * and a plan reaches a client's calendar through placement, not through here.
 */
export function useTrainingPlan({ clientId }: UseTrainingPlanProps) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  // Set only when `plan` is a program that has not started yet. Without it the
  // hero cannot tell a running program from a queued one and reports both as
  // active — which is how a retired future plan passed for the current one.
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [clientTimezone, setClientTimezone] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        setScheduledFor(data.scheduledFor ?? null);
        setClientTimezone(data.clientTimezone);
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

  return {
    clientId,
    plan,
    scheduledFor,
    clientTimezone,
    isLoading,
    loadError,
    savedPlanId,
    setSavedPlanId,
    fetchPlan,
  };
}
