"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import {
  parseSuggestionsResponse,
  parseSaveManualResponse,
  parseRefreshExercisesResponse,
} from "@/lib/validations/training";
import type {
  BuilderMode,
  ManualCreationMode,
  ManualSessionDraft,
  ManualExerciseDraft,
  WorkoutTemplate,
} from "@/types/training";

type UseTrainingBuilderProps = {
  clientId: string;
  onUpdate?: () => void;
};

export function useTrainingBuilder({ clientId, onUpdate }: UseTrainingBuilderProps) {
  const { toast } = useToast();

  // Get base training plan functionality
  const trainingPlan = useTrainingPlan({ clientId, onUpdate });

  // Builder mode state
  const [mode, setMode] = useState<BuilderMode>("ai");
  const [manualMode, setManualMode] = useState<ManualCreationMode>("template");

  // Quick suggestions state
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  // Manual creation state
  const [manualSessions, setManualSessions] = useState<ManualSessionDraft[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkoutTemplate | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isRefreshingExercises, setIsRefreshingExercises] = useState(false);

  // Toggle suggestion selection
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

  // Fetch AI-generated prompt suggestions
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

  // Manual session management
  const addManualSession = useCallback((session: ManualSessionDraft) => {
    setManualSessions((prev) => [...prev, session]);
  }, []);

  const updateManualSession = useCallback((tempId: string, updates: Partial<ManualSessionDraft>) => {
    setManualSessions((prev) =>
      prev.map((s) => (s.tempId === tempId ? { ...s, ...updates } : s))
    );
  }, []);

  const removeManualSession = useCallback((tempId: string) => {
    setManualSessions((prev) => prev.filter((s) => s.tempId !== tempId));
  }, []);

  // Manual exercise management
  const addExerciseToSession = useCallback((sessionTempId: string, exercise: ManualExerciseDraft) => {
    setManualSessions((prev) =>
      prev.map((s) =>
        s.tempId === sessionTempId
          ? { ...s, exercises: [...s.exercises, exercise] }
          : s
      )
    );
  }, []);

  const updateExerciseInSession = useCallback(
    (sessionTempId: string, exerciseTempId: string, updates: Partial<ManualExerciseDraft>) => {
      setManualSessions((prev) =>
        prev.map((s) =>
          s.tempId === sessionTempId
            ? {
                ...s,
                exercises: s.exercises.map((e) =>
                  e.tempId === exerciseTempId ? { ...e, ...updates } : e
                ),
              }
            : s
        )
      );
    },
    []
  );

  const removeExerciseFromSession = useCallback((sessionTempId: string, exerciseTempId: string) => {
    setManualSessions((prev) =>
      prev.map((s) =>
        s.tempId === sessionTempId
          ? { ...s, exercises: s.exercises.filter((e) => e.tempId !== exerciseTempId) }
          : s
      )
    );
  }, []);

  // Apply template to manual sessions
  const applyTemplate = useCallback((template: WorkoutTemplate) => {
    setSelectedTemplate(template);
    const sessions: ManualSessionDraft[] = template.sessions.map((ts) => ({
      tempId: crypto.randomUUID(),
      name: ts.name,
      focus: ts.focus,
      exercises: ts.exercises.map((te) => ({
        tempId: crypto.randomUUID(),
        name: te.name,
        sets: te.sets,
        repsTarget: te.repsTarget,
        notes: te.notes,
      })),
    }));
    setManualSessions(sessions);
  }, []);

  // Save manual plan
  const saveManualPlan = useCallback(async () => {
    if (manualSessions.length === 0) {
      toast({
        title: "No sessions",
        description: "Add at least one training session",
        variant: "destructive",
      });
      return false;
    }

    setIsSavingManual(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedTemplate?.name || "Custom Training Plan",
          splitType: selectedTemplate?.splitType || "custom",
          frequencyPerWeek: manualSessions.length,
          sessions: manualSessions,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }

      const rawData = await res.json();
      const data = parseSaveManualResponse(rawData);
      if (!data) {
        console.error("Invalid API response structure:", rawData);
        throw new Error("Invalid response from server");
      }
      if (data.success) {
        setManualSessions([]);
        setSelectedTemplate(null);
        toast({ title: "Plan created", description: "Manual training plan saved" });
        trainingPlan.fetchPlan();
        onUpdate?.();
        return true;
      } else {
        throw new Error(data.error || "Failed to save plan");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save plan",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSavingManual(false);
    }
  }, [clientId, manualSessions, selectedTemplate, toast, trainingPlan, onUpdate]);

  // Refresh exercises for all sessions
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

  // Reset builder state
  const resetBuilder = useCallback(() => {
    setMode("ai");
    setManualMode("template");
    setSelectedSuggestionIds([]);
    setAiSuggestions([]);
    setManualSessions([]);
    setSelectedTemplate(null);
    trainingPlan.setPrompt("");
    trainingPlan.setPreGenerationActivities([]);
  }, [trainingPlan]);

  return {
    // Base training plan state and methods
    ...trainingPlan,

    // Builder mode
    mode,
    setMode,
    manualMode,
    setManualMode,

    // AI suggestions
    selectedSuggestionIds,
    toggleSuggestion,
    aiSuggestions,
    isLoadingSuggestions,
    fetchAiSuggestions,

    // Manual creation
    manualSessions,
    selectedTemplate,
    isSavingManual,
    addManualSession,
    updateManualSession,
    removeManualSession,
    addExerciseToSession,
    updateExerciseInSession,
    removeExerciseFromSession,
    applyTemplate,
    saveManualPlan,

    // Refresh exercises
    refreshExercises,
    isRefreshingExercises,

    // Utils
    resetBuilder,
  };
}
