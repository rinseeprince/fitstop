import { useState, useEffect } from "react";
import type { CheckInFormData, CheckInExerciseHighlight } from "@/types/check-in";
import { sanitiseReps } from "@/utils/daily-logs-aggregation";

const STORAGE_KEY = "check-in-form-data";

/**
 * The client wizard's draft.
 *
 * `totalSteps` is not a constant any more (C6b): the step list derives from the
 * coach's form (`stepsForFields`), so a client whose coach turned photos off has
 * three steps, not four. It arrives AFTER mount — the context that carries the
 * form is still fetching — which is why the clamp below is an effect rather
 * than a guard inside the restore: a draft saved at step 4 must survive being
 * restored before the real step count is known, and then be pulled into range.
 */
export const useCheckInForm = (token: string, totalSteps: number) => {
  const [currentStep, setCurrentStep] = useState(1);
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
        setCurrentStep(parsed.step);
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

  // Pull the restored/current step back into range whenever the form shrinks —
  // covers both the late-arriving step count and a coach editing the form
  // between two visits to a saved draft.
  useEffect(() => {
    setCurrentStep((prev) => Math.min(prev, Math.max(1, totalSteps)));
  }, [totalSteps]);

  const nextStep = () => {
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const goToStep = (step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, totalSteps)));
  };

  const clearSavedData = () => {
    localStorage.removeItem(`${STORAGE_KEY}-${token}`);
    setFormData({});
    setCurrentStep(1);
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
