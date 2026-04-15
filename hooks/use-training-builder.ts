"use client";

import { useState, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import { useManualSessions } from "@/hooks/use-manual-sessions";
import {
  parseSuggestionsResponse,
  parseRefreshExercisesResponse,
} from "@/lib/validations/training";
import type {
  BuilderMode,
  ManualCreationMode,
} from "@/types/training";

type UseTrainingBuilderProps = {
  clientId: string;
  onUpdate?: () => void;
};

/**
 * Training plan builder hook that orchestrates AI generation and manual plan creation.
 *
 * This hook composes several concerns:
 * - Base training plan CRUD (via useTrainingPlan)
 * - Builder mode state (AI vs manual)
 * - AI suggestion management
 * - Manual session/exercise management (via useManualSessions)
 * - Template application
 *
 * Returns ~30 properties grouped by:
 * - trainingPlan.* - Base plan state and methods (plan, prompt, generate, etc.)
 * - mode/manualMode - Builder mode toggles
 * - AI suggestions - selectedSuggestionIds, aiSuggestions, fetchAiSuggestions
 * - Manual creation - manualSessions, add/update/remove methods, applyTemplate
 * - Utilities - refreshExercises, resetBuilder
 */
export function useTrainingBuilder({ clientId, onUpdate }: UseTrainingBuilderProps) {
  const { toast } = useToast();

  // ═══════════════════════════════════════════════════════════════════════════
  // BASE TRAINING PLAN
  // ═══════════════════════════════════════════════════════════════════════════
  const trainingPlan = useTrainingPlan({ clientId, onUpdate });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDER MODE STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const [mode, setMode] = useState<BuilderMode>("ai");
  const [manualMode, setManualMode] = useState<ManualCreationMode>("template");

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION PARAMETERS (UI-only, drives preview bar)
  // TODO: Include in generate() POST body when API supports session params
  // ═══════════════════════════════════════════════════════════════════════════
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3);
  const [sessionDuration, setSessionDuration] = useState(45);

  const totalMinutesPerWeek = useMemo(
    () => sessionsPerWeek * sessionDuration,
    [sessionsPerWeek, sessionDuration]
  );
  const estimatedExercises = useMemo(
    () => Math.round(sessionDuration / 7.5),
    [sessionDuration]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AI SUGGESTIONS STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUAL CREATION (extracted hook)
  // ═══════════════════════════════════════════════════════════════════════════
  const manual = useManualSessions({
    clientId,
    phaseId: trainingPlan.phaseId,
    setPhaseId: trainingPlan.setPhaseId,
    fetchPlan: trainingPlan.fetchPlan,
    setSavedPlanId: trainingPlan.setSavedPlanId,
    onUpdate,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI SUGGESTIONS METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Toggle a quick suggestion on/off, updating the prompt accordingly */
  const toggleSuggestion = useCallback((suggestionId: string, promptText: string) => {
    setSelectedSuggestionIds((prev) => {
      const isSelected = prev.includes(suggestionId);
      if (isSelected) {
        // Remove suggestion text from prompt
        const newPrompt = trainingPlan.prompt.replace(promptText, "").trim();
        trainingPlan.setPrompt(newPrompt);
        return prev.filter((id) => id !== suggestionId);
      } else {
        // Append suggestion text to prompt
        const separator = trainingPlan.prompt.trim() ? " " : "";
        trainingPlan.setPrompt(trainingPlan.prompt.trim() + separator + promptText);
        return [...prev, suggestionId];
      }
    });
  }, [trainingPlan]);

  /** Fetch AI-generated prompt suggestions from the server */
  const fetchAiSuggestions = useCallback(async () => {
    setIsLoadingSuggestions(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training/suggestions`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch suggestions: ${res.status}`);
      }
      const rawData = await res.json();
      const data = parseSuggestionsResponse(rawData);
      if (!data) {
        console.error("Invalid API response structure:", rawData);
        throw new Error("Invalid response from server");
      }
      if (data.success && data.suggestions) {
        setAiSuggestions(data.suggestions);
      }
    } catch (error) {
      console.error("Failed to fetch AI suggestions:", error);
      toast({
        title: "Couldn't load suggestions",
        description: "Try clicking 'Get more ideas' again",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [clientId, toast]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EXERCISE REFRESH AND UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  const [isRefreshingExercises, setIsRefreshingExercises] = useState(false);

  /** Refresh exercises for all sessions in the current plan */
  const refreshExercises = useCallback(async () => {
    if (!trainingPlan.plan) return false;

    setIsRefreshingExercises(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${trainingPlan.plan.id}/refresh-exercises`,
        { method: "POST" }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }

      const rawData = await res.json();
      const data = parseRefreshExercisesResponse(rawData);

      if (!data) {
        console.error("Invalid API response structure:", rawData);
        throw new Error("Invalid response from server");
      }

      if (data.success) {
        toast({
          title: "Exercises refreshed",
          description: "New exercises have been generated for your training sessions",
        });
        trainingPlan.fetchPlan();
        onUpdate?.();
        return true;
      } else {
        throw new Error(data.error || "Failed to refresh exercises");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to refresh exercises",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsRefreshingExercises(false);
    }
  }, [clientId, trainingPlan, toast, onUpdate]);

  /** Reset all builder state to initial values */
  const resetBuilder = useCallback(() => {
    setMode("ai");
    setManualMode("template");
    setSelectedSuggestionIds([]);
    setAiSuggestions([]);
    manual.resetManualSessions();
    setSessionsPerWeek(3);
    setSessionDuration(45);
    trainingPlan.setPrompt("");
    trainingPlan.setPreGenerationActivities([]);
  }, [trainingPlan, manual]);

  return {
    // Base training plan state and methods
    ...trainingPlan,

    // Builder mode
    mode,
    setMode,
    manualMode,
    setManualMode,

    // Session parameters (UI-only, drives preview bar)
    sessionsPerWeek,
    setSessionsPerWeek,
    sessionDuration,
    setSessionDuration,
    totalMinutesPerWeek,
    estimatedExercises,

    // AI suggestions
    selectedSuggestionIds,
    toggleSuggestion,
    aiSuggestions,
    isLoadingSuggestions,
    fetchAiSuggestions,

    // Manual creation
    ...manual,

    // Refresh exercises
    refreshExercises,
    isRefreshingExercises,

    // Utils
    resetBuilder,
  };
}
