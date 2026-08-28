"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { ArrowLeft, ArrowRight, Send, Clock } from "lucide-react";
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
import { useUnits } from "@/contexts/units-context";
import { toCanonicalCheckInSubmission } from "@/utils/check-in-canonical-metrics";
import { toast } from "sonner";
import type { SessionCompletionQuality } from "@/types/check-in";

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
  const { preference } = useUnits();

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

  // Pin 3: training fill-gap logging is fire-and-flush. Each per-event POST
  // registers its promise here; handleSubmit FLUSHES + AWAITS all of them before
  // calling the check-in submit, so the server's submit-time derivation reads
  // already-updated training_events.
  const pendingTrainingPosts = useRef<Set<Promise<void>>>(new Set());

  const logTrainingEvent = async (
    eventId: string,
    payload: { completionQuality: SessionCompletionQuality; notes?: string }
  ): Promise<void> => {
    const post = (async () => {
      const response = await fetch(`/api/client/training/events/${eventId}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Failed to log session");
      }
    })();

    pendingTrainingPosts.current.add(post);
    try {
      await post;
    } finally {
      pendingTrainingPosts.current.delete(post);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Flush + await any in-flight training fill-gap POSTs so the server's
      // submit-time workouts_completed derivation reads updated training_events.
      // allSettled: a failed per-event log already surfaced inline on its row;
      // it must not block the check-in submit.
      if (pendingTrainingPosts.current.size > 0) {
        await Promise.allSettled(Array.from(pendingTrainingPosts.current));
      }

      // The server DERIVES sessionCompletions / nutrition adherence / mood…stress
      // from the spine — the form only sends the qualitative fields it owns.
      //
      // The form holds the client's OWN display units while it is being filled
      // in; this is the single point where it becomes canonical kg/cm. It also
      // stamps the wire tags, which the schema now requires alongside any value
      // they describe — no default is applied server-side any more, because a
      // default silently decides the unit for a payload that never stated one.
      const result = await submitCheckIn(
        toCanonicalCheckInSubmission(formData, preference),
      );

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
                  trainingEventDetails={contextData.trainingEventDetails}
                  clientTimezone={contextData.clientInfo.timezone}
                  onLogEvent={logTrainingEvent}
                  trainingPeriodStats={contextData.trainingPeriodStats}
                  periodDays={contextData.periodDays}
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
