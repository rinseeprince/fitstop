"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useTrainingPlan } from "@/hooks/use-training-plan";
import { useManualSessions } from "@/hooks/use-manual-sessions";
import { parseSuggestionsResponse } from "@/lib/validations/training";
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
 * - Utilities - resetBuilder
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
  // PLAN NAME (shared across AI / Template / Scratch modes)
  // ═══════════════════════════════════════════════════════════════════════════
  const [planName, setPlanName] = useState("");

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

  /** Reset all builder state to initial values */
  const resetBuilder = useCallback(() => {
    setMode("ai");
    setManualMode("template");
    setSelectedSuggestionIds([]);
    setAiSuggestions([]);
    setPlanName("");
    manual.resetManualSessions();
    trainingPlan.setPrompt("");
  }, [trainingPlan, manual]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN-NAME-AWARE WRAPPERS
  // These inject the builder-level planName into downstream save calls so the
  // overlay/footer can keep calling generate() / saveManualPlan() with no args.
  // ═══════════════════════════════════════════════════════════════════════════

  const generateWithName = useCallback(
    (effectiveFrom?: string | null) =>
      trainingPlan.generate({ planName, effectiveFrom }),
    [trainingPlan, planName],
  );

  const saveManualPlanWithName = useCallback(
    (effectiveFrom?: string | null) =>
      manual.saveManualPlan({ planName, effectiveFrom }),
    [manual, planName],
  );

  const saveManualPlanAsTemplateWithName = useCallback(
    () => manual.saveManualPlanAsTemplate({ planName }),
    [manual, planName],
  );

  /**
   * Pre-fill the plan name from a picked template if the coach hasn't already
   * typed one — matches the expectation that a freshly-picked template "knows"
   * its own name but lets the coach override.
   */
  const applyTemplateWithName = useCallback(
    (template: Parameters<typeof manual.applyTemplate>[0]) => {
      manual.applyTemplate(template);
      setPlanName((current) => (current.trim().length === 0 ? template.name : current));
    },
    [manual],
  );

  return {
    // Base training plan state and methods
    ...trainingPlan,

    // Builder mode
    mode,
    setMode,
    manualMode,
    setManualMode,

    // Plan naming (top-level, shared across modes)
    planName,
    setPlanName,

    // AI suggestions
    selectedSuggestionIds,
    toggleSuggestion,
    aiSuggestions,
    isLoadingSuggestions,
    fetchAiSuggestions,

    // Manual creation (spread first so we can override specific methods below)
    ...manual,

    // Name-aware overrides
    generate: generateWithName,
    saveManualPlan: saveManualPlanWithName,
    saveManualPlanAsTemplate: saveManualPlanAsTemplateWithName,
    applyTemplate: applyTemplateWithName,

    // Utils
    resetBuilder,
  };
}
