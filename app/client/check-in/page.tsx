"use client";

import { useState } from "react";
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
import { StepHabits } from "@/components/check-in/step-habits";
import { FormSuccess } from "@/components/check-in/form-success";
import {
  PastCheckInsSection,
  PAST_CHECK_INS_SWR_KEY,
} from "@/components/client-portal/check-in/past-check-ins-section";
import { useCheckInForm } from "@/hooks/use-check-in-form";
import { useClientCheckIn } from "@/hooks/use-client-check-in";
import { useInvalidateClientProfile } from "@/hooks/use-client-profile";
import { usePendingWrites } from "@/hooks/use-pending-writes";
import { useUnits } from "@/contexts/units-context";
import { toCanonicalCheckInSubmission } from "@/utils/check-in-canonical-metrics";
import {
  CHECK_IN_STEP_LABELS,
  DEFAULT_CHECK_IN_FORM_FIELDS,
  applyCheckInForm,
  wizardSteps,
} from "@/lib/check-in/form-fields";
import { toast } from "sonner";
import type { LoggedQuality } from "@/types/training";

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
  const invalidateClientProfile = useInvalidateClientProfile();
  const { contextData, isLoadingContext, contextError, nextDueDate, submitCheckIn } =
    useClientCheckIn();
  const { preference } = useUnits();

  // The coach's form decides which fields are asked and therefore which steps
  // exist. No form on the payload — an older client app, or a client whose
  // coach has never customised anything — resolves to all 14 keys, which is the
  // whole backward-compatibility story for this feature. A week the client had
  // a habit in adds the Habits step, last; the context read decides it once.
  const fields = contextData?.form?.fields ?? [...DEFAULT_CHECK_IN_FORM_FIELDS];
  const questions = contextData?.form?.questions ?? [];
  const habitWeek = contextData?.habitWeek ?? null;
  const steps = wizardSteps(fields, (habitWeek?.habits.length ?? 0) > 0);

  const {
    currentStep,
    formData,
    isSubmitting,
    setIsSubmitting,
    updateFormData,
    nextStep,
    prevStep,
    clearSavedData,
    // The step count is not known until the context has loaded.
  } = useCheckInForm("client-check-in", contextData ? steps.length : null);

  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared by the Training and Habits steps: a workout the client logs on the
  // Training step and a habit entry made on the Habits step each save on
  // their own, and Send waits for every one of them, so the server's
  // submit-time figures and the check-in's frozen copy read the client's week
  // with them in it.
  const { track, flush } = usePendingWrites();

  const logTrainingEvent = (
    eventId: string,
    payload: { completionQuality: LoggedQuality; notes?: string }
  ): Promise<void> =>
    track(
      (async () => {
        const response = await fetch(`/api/client/training/events/${eventId}/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Failed to log session");
        }
      })()
    );

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Every workout and habit entry still on its way, first. A write that
      // failed has said so on its own step; it does not stop the send.
      await flush();

      // Shape the draft to the form the coach actually asks BEFORE converting
      // units. A saved draft can predate a coach's change, and there is no
      // reason to ship a base64 photo the server is only going to discard. The
      // server runs the same strip after its own gate — that one is the
      // authority; this one is courtesy.
      //
      // The server DERIVES the week's training and nutrition figures and
      // mood…stress from the client's logs — the form only sends the qualitative
      // fields it owns.
      //
      // The form holds the client's OWN display units while it is being filled
      // in; this is the single point where it becomes canonical kg/cm. It also
      // stamps the wire tags, which the schema now requires alongside any value
      // they describe — no default is applied server-side any more, because a
      // default silently decides the unit for a payload that never stated one.
      const shaped = applyCheckInForm(formData, {
        fields,
        questionIds: questions.map((q) => q.id),
      });
      const result = await submitCheckIn(
        toCanonicalCheckInSubmission(shaped, preference),
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to submit check-in");
      }

      clearSavedData();
      setIsSuccess(true);
      toast.success("Check-in submitted successfully!");
      // Refresh the past-check-ins list so the new submission appears below.
      void mutate(PAST_CHECK_INS_SWR_KEY);
      // The submit just closed this week. Every screen that locks a day reads
      // the boundary off the client's profile, and no cache here can reach that
      // one without asking for it (CONVENTIONS §7).
      invalidateClientProfile();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // The step being rendered, by KIND rather than by index: a client whose coach
  // turned photos off has Training at position 3, and an index-keyed switch
  // would render Photos there.
  const activeStep = steps[currentStep - 1];

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
        ) : contextError === "unscheduled" ? (
          <Card className="w-full max-w-md mx-auto text-center">
            <CardContent className="py-12 space-y-4">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto" />
              <h2 className="text-xl font-semibold">Not scheduled</h2>
              <p className="text-muted-foreground">
                Your coach has not scheduled your check-ins yet.
              </p>
            </CardContent>
          </Card>
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
              totalSteps={steps.length}
              stepLabels={steps.map((step) => CHECK_IN_STEP_LABELS[step])}
            />

            <div className="bg-card border border-border p-6 md:p-8 min-h-[500px]">
              {activeStep === "feeling" && (
                <StepSubjective
                  data={formData}
                  onChange={updateFormData}
                  dailyLogs={contextData.dailyLogs}
                  periodStart={contextData.periodStart}
                  periodEnd={contextData.periodEnd}
                  fields={fields}
                  questions={questions}
                />
              )}

              {activeStep === "metrics" && (
                <StepMetrics
                  data={formData}
                  onChange={updateFormData}
                  previousData={{}}
                  fields={fields}
                />
              )}

              {activeStep === "photos" && (
                <StepPhotos data={formData} onChange={updateFormData} fields={fields} />
              )}

              {activeStep === "training" && (
                <StepTraining
                  data={formData}
                  onChange={updateFormData}
                  trainingContext={contextData.trainingContext}
                  trainingEventDetails={contextData.trainingEventDetails}
                  clientTimezone={contextData.clientInfo.timezone}
                  logsOpenFrom={contextData.clientInfo.logsOpenFrom ?? null}
                  onLogEvent={logTrainingEvent}
                  trainingPeriodStats={contextData.trainingPeriodStats}
                  nutritionSummary={contextData.nutritionSummary ?? null}
                  fields={fields}
                />
              )}

              {activeStep === "habits" && habitWeek && (
                <StepHabits
                  habitWeek={habitWeek}
                  clientTimezone={contextData.clientInfo.timezone ?? "UTC"}
                  logsOpenFrom={contextData.clientInfo.logsOpenFrom ?? null}
                  trackWrite={track}
                  disabled={isSubmitting}
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

              {currentStep < steps.length ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  disabled={isSubmitting}
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
