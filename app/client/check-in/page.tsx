"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { ArrowLeft, ArrowRight, Send, CalendarCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressIndicator } from "@/components/check-in/progress-indicator";
import { StepSubjective } from "@/components/check-in/step-subjective";
import { StepMetrics } from "@/components/check-in/step-metrics";
import { StepPhotos } from "@/components/check-in/step-photos";
import { StepTraining } from "@/components/check-in/step-training";
import { FormSuccess } from "@/components/check-in/form-success";
import {
  PastCheckInsSection,
  PAST_CHECK_INS_SWR_KEY,
} from "@/components/client-portal/check-in/past-check-ins-section";
import { useCheckInForm } from "@/hooks/use-check-in-form";
import { useClientCheckIn } from "@/hooks/use-client-check-in";
import { toast } from "sonner";
import { aggregateDailyLogs } from "@/utils/daily-logs-aggregation";

const stepLabels = ["Feeling", "Metrics", "Photos", "Training"];

function formatNextDueDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function ClientCheckInPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { contextData, isLoadingContext, contextError, nextDueDate, submitCheckIn } =
    useClientCheckIn();

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
      const enrichedFormData = { ...formData };

      if (contextData?.dailyLogs && contextData.dailyLogs.length > 0) {
        const aggregated = aggregateDailyLogs(contextData.dailyLogs);

        if (!enrichedFormData.nutritionAdherence) {
          enrichedFormData.nutritionAdherence = {};
        }
        enrichedFormData.nutritionAdherence.daysOnTarget = aggregated.nutritionHitDays;

        if (!enrichedFormData.workoutsCompleted && !enrichedFormData.sessionCompletions?.length) {
          enrichedFormData.workoutsCompleted = contextData.trainingPeriodStats?.sessionsCompleted
            ?? aggregated.sessionsCompleted;
        }
      }

      const result = await submitCheckIn(enrichedFormData);

      if (!result.success) {
        throw new Error(result.error || "Failed to submit check-in");
      }

      clearSavedData();
      setIsSuccess(true);
      toast.success("Check-in submitted successfully!");
      // Refresh the past-check-ins list so the new submission appears below.
      void mutate(PAST_CHECK_INS_SWR_KEY);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    if (currentStep === 1) return true;
    if (currentStep === 2) return true;
    if (currentStep === 3) return true;
    if (currentStep === 4) return true;
    return false;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto px-4 py-12 space-y-12">
        <div className="text-center">
          <h1 className="text-3xl font-semibold mb-2">Check-In</h1>
          {contextData?.clientInfo.name && !isSuccess && !contextError && (
            <p className="text-muted-foreground">
              Hey {contextData.clientInfo.name}! Let&apos;s see how you&apos;re doing.
            </p>
          )}
        </div>

        {isLoadingContext ? (
          <Card className="w-full max-w-md mx-auto text-center">
            <CardContent className="py-12">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              <p className="text-muted-foreground">Loading check-in form...</p>
            </CardContent>
          </Card>
        ) : isSuccess ? (
          <FormSuccess
            clientName={contextData?.clientInfo.name ?? ""}
            coachName={contextData?.clientInfo.coachName ?? "Your Coach"}
          />
        ) : contextError === "not_due" ? (
          <Card className="w-full max-w-md mx-auto text-center">
            <CardContent className="py-12 space-y-4">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto" />
              <h2 className="text-xl font-semibold">Not due yet</h2>
              <p className="text-muted-foreground">
                {nextDueDate
                  ? `Next check-in opens on ${formatNextDueDate(nextDueDate)}.`
                  : "Your next check-in opens on your scheduled day."}
              </p>
            </CardContent>
          </Card>
        ) : contextError === "completed" ? (
          <Card className="w-full max-w-md mx-auto text-center">
            <CardContent className="py-12 space-y-4">
              <CalendarCheck className="h-12 w-12 text-success mx-auto" />
              <h2 className="text-xl font-semibold">Already completed</h2>
              <p className="text-muted-foreground">
                You&apos;ve already submitted your check-in for this week. Great job!
              </p>
              {nextDueDate && (
                <p className="text-sm text-muted-foreground">
                  Next check-in opens on {formatNextDueDate(nextDueDate)}.
                </p>
              )}
            </CardContent>
          </Card>
        ) : contextError || !contextData ? (
          <Card className="w-full max-w-md mx-auto text-center">
            <CardContent className="py-12">
              <p className="mb-4 text-destructive">
                {contextError || "Failed to load check-in form"}
              </p>
              <Button onClick={() => window.location.reload()}>Try Again</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <ProgressIndicator
              currentStep={currentStep}
              totalSteps={4}
              stepLabels={stepLabels}
            />

            <div className="bg-card border border-border p-6 md:p-8 min-h-[500px]">
              {currentStep === 1 && (
                <StepSubjective
                  data={formData}
                  onChange={updateFormData}
                  dailyLogs={contextData.dailyLogs}
                  periodStart={contextData.periodStart}
                  periodEnd={contextData.periodEnd}
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
                  trainingPeriodStats={contextData.trainingPeriodStats}
                  periodDays={contextData.periodDays}
                  weightUnit={formData.weightUnit || "lbs"}
                  frequencyDays={contextData.clientInfo.checkInFrequencyDays}
                  dailyLogs={contextData.dailyLogs}
                />
              )}
            </div>

            {error && (
              <div className="bg-destructive/5 border border-destructive/20 p-4">
                <p className="text-sm text-destructive text-center">{error}</p>
              </div>
            )}

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

            <p className="text-xs text-center text-muted-foreground">
              Your progress is automatically saved
            </p>
          </div>
        )}

        <PastCheckInsSection />
      </div>
    </div>
  );
}
