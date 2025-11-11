"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressIndicator } from "./progress-indicator";
import { StepSubjective } from "./step-subjective";
import { StepMetrics } from "./step-metrics";
import { StepPhotos } from "./step-photos";
import { StepTraining } from "./step-training";
import { FormSuccess } from "./form-success";
import { useCheckInForm } from "@/hooks/use-check-in-form";
import type { CheckInFormData, CheckInClientInfo } from "@/types/check-in";

type CheckInFormProps = {
  token: string;
  clientInfo: CheckInClientInfo;
};

const stepLabels = ["Feeling", "Metrics", "Photos", "Training"];

export const CheckInForm = ({ token, clientInfo }: CheckInFormProps) => {
  const {
    currentStep,
    formData,
    isSubmitting,
    setIsSubmitting,
    updateFormData,
    nextStep,
    prevStep,
    clearSavedData,
  } = useCheckInForm(token);

  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/check-in/submit/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.errorMessage || "Failed to submit check-in");
      }

      clearSavedData();
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <FormSuccess
        clientName={clientInfo.name}
        coachName={clientInfo.coachName}
      />
    );
  }

  const canProceed = () => {
    if (currentStep === 1) return true;
    if (currentStep === 2) return true;
    if (currentStep === 3) return true;
    if (currentStep === 4) return true;
    return false;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Check-In</h1>
        <p className="text-muted-foreground">
          Hey {clientInfo.name}! Let's see how you're doing.
        </p>
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator
        currentStep={currentStep}
        totalSteps={4}
        stepLabels={stepLabels}
      />

      {/* Form Steps */}
      <div className="glass-card p-6 md:p-8 min-h-[500px]">
        {currentStep === 1 && (
          <StepSubjective
            data={formData}
            onChange={updateFormData}
          />
        )}

        {currentStep === 2 && (
          <StepMetrics
            data={formData}
            onChange={updateFormData}
            previousData={{}}
          />
        )}

        {currentStep === 3 && (
          <StepPhotos data={formData} onChange={updateFormData} />
        )}

        {currentStep === 4 && (
          <StepTraining data={formData} onChange={updateFormData} />
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 border-destructive bg-destructive/10">
          <p className="text-sm text-destructive text-center">{error}</p>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={prevStep}
          disabled={currentStep === 1 || isSubmitting}
          className="flex-1 sm:flex-none"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        {currentStep < 4 ? (
          <Button
            type="button"
            onClick={nextStep}
            disabled={!canProceed() || isSubmitting}
            className="flex-1 sm:flex-none"
          >
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 sm:flex-none"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin mr-2" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit Check-In
              </>
            )}
          </Button>
        )}
      </div>

      {/* Auto-save indicator */}
      <p className="text-xs text-center text-muted-foreground">
        Your progress is automatically saved
      </p>
    </div>
  );
};
