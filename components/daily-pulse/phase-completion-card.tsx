"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Circle, ArrowRight, Flag } from "lucide-react";
import { swrFetcher } from "@/lib/swr-fetcher";
import { weightFromKg } from "@/utils/nutrition-helpers";

type MilestoneItem = {
  id: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
};

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
    milestones: MilestoneItem[];
  };
};

function formatMilestoneDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function PhaseCompletionCard() {
  const [isDismissing, setIsDismissing] = useState(false);

  const { data, error, mutate } = useSWR<PhaseCompletionResponse>(
    "/api/client/phase-completion",
    swrFetcher,
    { revalidateOnFocus: false }
  );

  // Render nothing if no pending completion or error/loading
  if (error || !data?.success || !data?.data) return null;

  const { phaseId, phaseName, coachReflection, phaseSummary, weightUnit, nextPhaseName, milestones } =
    data.data;
  const unit = weightUnit || "lbs";
  const adherence = phaseSummary?.adherence;
  const metrics = phaseSummary?.metricsSnapshot;
  const weightChange =
    metrics?.startWeight && metrics?.endWeight
      ? metrics.endWeight - metrics.startWeight
      : null;
  const phaseGoals = phaseSummary?.phaseGoals;
  const completedMilestones = milestones?.filter((m) => m.completed).length ?? 0;
  const totalMilestones = milestones?.length ?? 0;

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
    <Card className="border-[rgba(13,148,136,0.08)] bg-white rounded-[6px]">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-[#0d9488]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#0c1a1e]">Phase completed!</p>
            <p className="text-xs text-[#93b0b4]">{phaseName}</p>
          </div>
          {totalMilestones > 0 && (
            <span className="text-[10px] font-semibold bg-[rgba(13,148,136,0.05)] text-[#0d9488] px-1.5 py-0.5 rounded-[6px] shrink-0">
              {completedMilestones}/{totalMilestones} milestones
            </span>
          )}
        </div>

        {coachReflection && (
          <p className="text-sm text-[#93b0b4] italic">
            &quot;{coachReflection}&quot;
          </p>
        )}

        {/* Summary stats */}
        <div className="flex gap-4 text-xs text-[#93b0b4]">
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

        {/* Milestones */}
        {totalMilestones > 0 && (
          <div className="border-t border-[rgba(13,148,136,0.08)] pt-3">
            <div className="flex items-center gap-2 mb-2">
              <Flag className="h-3.5 w-3.5 text-[#93b0b4]" />
              <span className="text-[10px] uppercase text-[#93b0b4] tracking-[0.06em] font-semibold">
                Milestones
              </span>
              <span className="text-[10px] font-semibold bg-[rgba(13,148,136,0.05)] text-[#0d9488] px-1.5 py-0.5 rounded-[6px]">
                {completedMilestones}/{totalMilestones}
              </span>
            </div>
            <ul className="space-y-1.5">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-start gap-2">
                  {m.completed ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0d9488] mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-[#93b0b4] mt-0.5" />
                  )}
                  <span className={`text-[12.5px] ${m.completed ? "text-[#0c1a1e]" : "text-[#93b0b4]"}`}>
                    {m.text}
                  </span>
                  {m.completed && m.completed_at && (
                    <span className="font-mono-display text-[#93b0b4] text-[11px] ml-auto shrink-0">
                      {formatMilestoneDate(m.completed_at)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {nextPhaseName && (
          <div className="flex items-center gap-1 text-xs text-[#93b0b4]">
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
