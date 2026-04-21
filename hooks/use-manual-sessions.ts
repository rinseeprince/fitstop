"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  parseSaveManualResponse,
} from "@/lib/validations/training";
import type {
  ManualSessionDraft,
  ManualExerciseDraft,
  WorkoutTemplate,
} from "@/types/training";

type UseManualSessionsProps = {
  clientId: string;
  fetchPlan: () => Promise<void> | void;
  setSavedPlanId: (id: string | null) => void;
  onUpdate?: () => void;
};

export function useManualSessions({
  clientId,
  fetchPlan,
  setSavedPlanId,
  onUpdate,
}: UseManualSessionsProps) {
  const { toast } = useToast();

  const [manualSessions, setManualSessions] = useState<ManualSessionDraft[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkoutTemplate | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUAL SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Add a new manual session to the builder */
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

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUAL EXERCISE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Add an exercise to a manual session */
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

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE AND SAVE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Apply a workout template: populate session names + focus only. Exercises are added later in DraftEditor. */
  const applyTemplate = useCallback((template: WorkoutTemplate) => {
    setSelectedTemplate(template);
    const sessions: ManualSessionDraft[] = template.sessions.map((ts) => ({
      tempId: crypto.randomUUID(),
      name: ts.name,
      focus: ts.focus,
      exercises: [],
    }));
    setManualSessions(sessions);
  }, []);

  type SaveManualOptions = {
    planName?: string;
    effectiveFrom?: string | null;
  };

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  /**
   * Shared POST-manual body builder. Keeps the payload in one place so
   * saveManualPlan and saveManualPlanAsTemplate don't drift.
   */
  const buildManualPayload = useCallback((options: SaveManualOptions) => {
    const trimmedName = options.planName?.trim();
    return {
      name: trimmedName || selectedTemplate?.name || "Custom Training Plan",
      splitType: selectedTemplate?.splitType || "custom",
      // frequencyPerWeek here means "training sessions per cycle" for the schema;
      // the server recomputes it from is_rest flags, but we still send a sane value.
      frequencyPerWeek: manualSessions.filter((s) => !s.isRest).length || 1,
      sessions: manualSessions,
      effectiveFrom: options.effectiveFrom ?? undefined,
    };
  }, [manualSessions, selectedTemplate]);

  /** Save the manual plan to the server as a draft — coach continues to DraftEditor. */
  const saveManualPlan = useCallback(async (options: SaveManualOptions = {}) => {
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
        body: JSON.stringify(buildManualPayload(options)),
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
      if (data.success && data.savedPlanId) {
        setSavedPlanId(data.savedPlanId);
        setManualSessions([]);
        setSelectedTemplate(null);
        toast({ title: "Plan draft created" });
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
  }, [clientId, manualSessions, toast, setSavedPlanId, buildManualPayload]);

  /**
   * Save the current scratch session structure directly to the coach library
   * as a reusable template. Chains save-draft + promote-to-saved in one UX step.
   * Skips the DraftEditor transition — the coach returns to the builder afterwards.
   */
  const saveManualPlanAsTemplate = useCallback(async (options: SaveManualOptions = {}) => {
    if (manualSessions.length === 0) {
      toast({
        title: "No sessions",
        description: "Add at least one training session",
        variant: "destructive",
      });
      return false;
    }

    setIsSavingTemplate(true);
    try {
      const createRes = await fetch(`/api/clients/${clientId}/training/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildManualPayload(options)),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${createRes.status}`);
      }

      const rawData = await createRes.json();
      const data = parseSaveManualResponse(rawData);
      if (!data?.success || !data.savedPlanId) {
        throw new Error(data?.error || "Failed to save plan");
      }

      const promoteRes = await fetch(
        `/api/training/saved-plans/${data.savedPlanId}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ saveSessionsIndividually: false }),
        },
      );

      if (!promoteRes.ok) {
        toast({
          title: "Saved as draft",
          description: "We saved it as a draft. Open Saved Plans to finish saving.",
          variant: "destructive",
        });
        return false;
      }

      setManualSessions([]);
      setSelectedTemplate(null);
      toast({ title: "Saved to library" });
      return true;
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save template",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSavingTemplate(false);
    }
  }, [clientId, manualSessions, toast, buildManualPayload]);

  /** Reset manual session state */
  const resetManualSessions = useCallback(() => {
    setManualSessions([]);
    setSelectedTemplate(null);
  }, []);

  return {
    manualSessions,
    selectedTemplate,
    isSavingManual,
    isSavingTemplate,
    addManualSession,
    updateManualSession,
    removeManualSession,
    addExerciseToSession,
    updateExerciseInSession,
    removeExerciseFromSession,
    applyTemplate,
    saveManualPlan,
    saveManualPlanAsTemplate,
    resetManualSessions,
  };
}
