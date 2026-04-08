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
  phaseId: string | undefined;
  setPhaseId: (id: string | undefined) => void;
  fetchPlan: () => void;
  onUpdate?: () => void;
};

export function useManualSessions({
  clientId,
  phaseId,
  setPhaseId,
  fetchPlan,
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

  /** Apply a workout template to populate manual sessions */
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

  /** Save the manual plan to the server */
  const saveManualPlan = useCallback(async (effectiveFrom?: string | null) => {
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
          phaseId: phaseId || undefined,
          effectiveFrom: effectiveFrom ?? undefined,
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
        setPhaseId(undefined);
        toast({ title: "Plan created", description: "Manual training plan saved" });
        fetchPlan();
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
  }, [clientId, manualSessions, selectedTemplate, toast, phaseId, setPhaseId, fetchPlan, onUpdate]);

  /** Reset manual session state */
  const resetManualSessions = useCallback(() => {
    setManualSessions([]);
    setSelectedTemplate(null);
  }, []);

  return {
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
    resetManualSessions,
  };
}
