"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressIndicator } from "@/components/check-in/progress-indicator";
import { StepSubjective } from "@/components/check-in/step-subjective";
import { StepMetrics } from "@/components/check-in/step-metrics";
import { StepPhotos } from "@/components/check-in/step-photos";
import { StepTraining } from "@/components/check-in/step-training";
import { FormSuccess } from "@/components/check-in/form-success";
import { useCheckInForm } from "@/hooks/use-check-in-form";
import { useClientCheckIn } from "@/hooks/use-client-check-in";
import type { CheckInFormData } from "@/types/check-in";
import { toast } from "sonner";
import { aggregateDailyLogs } from "@/utils/daily-logs-aggregation";

const stepLabels = ["Feeling", "Metrics", "Photos", "Training"];

export default function ClientCheckInPage() {
  const router = useRouter();
  const { contextData, isLoadingContext, contextError, submitCheckIn } = useClientCheckIn();
  
  // Use a dummy token since we don't need it for client app
  const {
    currentStep,
    formData,
    isSubmitting,
    setIsSubmitting,
    updateFormData,
    nextStep,
    prevStep,
    clearSavedData,
  } = useCheckInForm("client-check-in");

  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // If we have daily logs, aggregate and populate the nutrition data
      let enrichedFormData = { ...formData };
      
      if (contextData.dailyLogs && contextData.dailyLogs.length > 0) {
        const aggregated = aggregateDailyLogs(contextData.dailyLogs);
        
        // Auto-populate nutrition days on target from daily logs
        if (!enrichedFormData.nutritionAdherence) {
          enrichedFormData.nutritionAdherence = {};
        }
        enrichedFormData.nutritionAdherence.daysOnTarget = aggregated.nutritionHitDays;
        
        // Auto-populate workouts completed if not manually set
        if (!enrichedFormData.workoutsCompleted && !enrichedFormData.sessionCompletions?.length) {
          enrichedFormData.workoutsCompleted = aggregated.sessionsCompleted;
        }
      }
      
      const result = await submitCheckIn(enrichedFormData);

      if (!result.success) {
        throw new Error(result.error || "Failed to submit check-in");
      }

      clearSavedData();
      setIsSuccess(true);
      toast.success("Check-in submitted successfully!");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (isLoadingContext) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-muted-foreground">Loading check-in form...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (contextError || !contextData) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12">
            <p className="mb-4 text-destructive">
              {contextError || "Failed to load check-in form"}
            </p>
            <Button onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        <div className="container max-w-3xl mx-auto px-4 py-12">
          <FormSuccess
            clientName={contextData.clientInfo.name}
            coachName={contextData.clientInfo.coachName}
          />
        </div>
      </div>
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container max-w-3xl mx-auto px-4 py-12">
        <div className="space-y-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">Check-In</h1>
            <p className="text-muted-foreground">
              Hey {contextData.clientInfo.name}! Let's see how you're doing.
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
                dailyLogs={contextData.dailyLogs}
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
              <StepTraining
                data={formData}
                onChange={updateFormData}
                trainingContext={contextData.trainingContext}
                nutritionContext={contextData.nutritionContext}
                weightUnit={formData.weightUnit || "lbs"}
                frequencyDays={contextData.clientInfo.checkInFrequencyDays}
                dailyLogs={contextData.dailyLogs}
              />
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
              onClick={currentStep === 1 ? () => router.back() : prevStep}
              disabled={isSubmitting}
              className="flex-1 sm:flex-none"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {currentStep === 1 ? "Cancel" : "Back"}
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
      </div>
    </div>
  );
}