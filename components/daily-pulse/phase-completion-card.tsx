"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { swrFetcher } from "@/lib/swr-fetcher";
import { weightFromKg } from "@/utils/nutrition-helpers";

type PhaseCompletionResponse = {
  success: boolean;
  data: {
    phaseId: string;
    phaseName: string;
    coachReflection: string | null;
    phaseSummary: {
      metricsSnapshot?: {
        startWeight?: number | null;
        endWeight?: number | null;
      };
      adherence?: {
        training?: { percentage: number | null; completed: number } | null;
        nutrition?: { averageScore: number } | null;
        habits?: { percentage: number } | null;
      };
      phaseGoals?: {
        goalWeight: number | null;
        goalBodyFatPercentage: number | null;
      } | null;
    } | null;
    endDate: string | null;
    weightUnit: "lbs" | "kg";
    nextPhaseName: string | null;
  };
};

export function PhaseCompletionCard() {
  const [isDismissing, setIsDismissing] = useState(false);

  const { data, error, mutate } = useSWR<PhaseCompletionResponse>(
    "/api/client/phase-completion",
    swrFetcher,
    { revalidateOnFocus: false }
  );

  // Render nothing if no pending completion or error/loading
  if (error || !data?.success || !data?.data) return null;

  const { phaseId, phaseName, coachReflection, phaseSummary, weightUnit, nextPhaseName } =
    data.data;
  const unit = weightUnit || "lbs";
  const adherence = phaseSummary?.adherence;
  const metrics = phaseSummary?.metricsSnapshot;
  const weightChange =
    metrics?.startWeight && metrics?.endWeight
      ? metrics.endWeight - metrics.startWeight
      : null;
  const phaseGoals = phaseSummary?.phaseGoals;

  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      await fetch("/api/client/phase-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId }),
      });
      await mutate(undefined, { revalidate: true });
    } catch {
      // Non-critical: card will show again on next visit
    } finally {
      setIsDismissing(false);
    }
  };

  return (
    <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">Phase completed!</p>
            <p className="text-xs text-muted-foreground">{phaseName}</p>
          </div>
        </div>

        {coachReflection && (
          <p className="text-sm text-muted-foreground italic">
            &quot;{coachReflection}&quot;
          </p>
        )}

        {/* Summary stats */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          {adherence?.training && (
            <span>
              Training:{" "}
              {adherence.training.percentage !== null
                ? `${adherence.training.percentage}%`
                : `${adherence.training.completed} sessions`}
            </span>
          )}
          {adherence?.nutrition && (
            <span>Nutrition: {adherence.nutrition.averageScore}%</span>
          )}
          {weightChange !== null && (
            <span>
              Weight: {weightChange > 0 ? "+" : weightChange < 0 ? "-" : ""}
              {weightFromKg(Math.abs(weightChange), unit).toFixed(1)} {unit}
            </span>
          )}
          {phaseGoals?.goalWeight != null && metrics?.endWeight != null && (
            <span>
              Goal: {weightFromKg(phaseGoals.goalWeight, unit).toFixed(1)} {unit} | Actual: {weightFromKg(metrics.endWeight, unit).toFixed(1)} {unit}
            </span>
          )}
        </div>

        {nextPhaseName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowRight className="h-3 w-3" />
            <span>Up next: {nextPhaseName}</span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleDismiss}
          disabled={isDismissing}
        >
          {isDismissing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Got it"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
