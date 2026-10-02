import { useState, useEffect } from "react";
import type { CheckInFormData, CheckInExerciseHighlight } from "@/types/check-in";
import { sanitiseReps } from "@/utils/daily-logs-aggregation";

const STORAGE_KEY = "check-in-form-data";

/**
 * The client wizard's draft.
 *
 * `totalSteps` is not a constant any more (C6b): the step list derives from the
 * coach's form and the client's habit week (`wizardSteps`), so a client whose
 * coach turned photos off has three steps, not four, and a week with habits
 * has one more. It arrives AFTER mount — the context that carries the form and
 * the habit week is still fetching — and is null until then. The step a draft
 * was saved on is kept as asked, and the step shown is derived from it at
 * render, pulled into the steps there are once their count is known: a draft
 * saved on its last step, Habits, survives being restored before the count is
 * known, and a draft restored into fewer steps never paints a step past the
 * last.
 */
export const useCheckInForm = (token: string, totalSteps: number | null) => {
  const [askedStep, setAskedStep] = useState(1);
  const currentStep = totalSteps === null ? askedStep : Math.min(askedStep, Math.max(1, totalSteps));
  // No seeded unit tag. The form holds the client's own display units and
  // toCanonicalCheckInSubmission stamps the wire tags at submit; seeding one
  // here would state a unit before the viewer's preference had been consulted.
  const [formData, setFormData] = useState<Partial<CheckInFormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load saved form data from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}-${token}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        let data = parsed.data;
        
        // Sanitize exercise highlights reps when loading from localStorage
        if (data.exerciseHighlights && Array.isArray(data.exerciseHighlights)) {
          data = {
            ...data,
            exerciseHighlights: data.exerciseHighlights.map((highlight: Partial<CheckInExerciseHighlight>) => ({
              ...highlight,
              reps: sanitiseReps(highlight.reps)
            }))
          };
        }
        
        setFormData(data);
        setAskedStep(parsed.step);
      } catch (error) {
        console.error("Failed to load saved form data:", error);
      }
    }
  }, [token]);

  // Auto-save form data to localStorage
  useEffect(() => {
    if (Object.keys(formData).length > 0) {
      localStorage.setItem(
        `${STORAGE_KEY}-${token}`,
        JSON.stringify({
          data: formData,
          step: currentStep,
          savedAt: new Date().toISOString(),
        })
      );
    }
  }, [formData, currentStep, token]);

  const updateFormData = (data: Partial<CheckInFormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  // Every move is from the step shown. The wizard is not on screen until the
  // step count is known, so a move before then has nothing to move through.
  const nextStep = () => {
    if (totalSteps === null) return;
    setAskedStep(Math.min(currentStep + 1, totalSteps));
  };

  const prevStep = () => {
    setAskedStep(Math.max(currentStep - 1, 1));
  };

  const goToStep = (step: number) => {
    if (totalSteps === null) return;
    setAskedStep(Math.max(1, Math.min(step, totalSteps)));
  };

  const clearSavedData = () => {
    localStorage.removeItem(`${STORAGE_KEY}-${token}`);
    setFormData({});
    setAskedStep(1);
  };

  return {
    currentStep,
    formData,
    isSubmitting,
    setIsSubmitting,
    updateFormData,
    nextStep,
    prevStep,
    goToStep,
    clearSavedData,
  };
};
