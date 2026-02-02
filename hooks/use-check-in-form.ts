import { useState, useEffect } from "react";
import type { CheckInFormData } from "@/types/check-in";

const STORAGE_KEY = "check-in-form-data";

export const useCheckInForm = (token: string) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<CheckInFormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load saved form data from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}-${token}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFormData(parsed.data);
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

  const nextStep = () => {
    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const goToStep = (step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, 4)));
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
