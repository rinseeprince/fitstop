"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { swrFetcher } from "@/lib/swr-fetcher";
import { PhaseReviewStats } from "./phase-review-stats";
import { PhaseReviewMilestones } from "./phase-review-milestones";
import type { Phase, PhaseReviewData, Milestone } from "@/types/roadmap";

type PhaseReviewDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phase: Phase;
  clientId: string;
  weightUnit: "lbs" | "kg";
  onTransitionComplete: () => void;
};

export function PhaseReviewDrawer({
  open,
  onOpenChange,
  phase,
  clientId,
  weightUnit,
  onTransitionComplete,
}: PhaseReviewDrawerProps) {
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const [reflection, setReflection] = useState("");
  const [nextAction, setNextAction] = useState<
    "activate_next" | "archive_roadmap"
  >("activate_next");
  const [archiveTraining, setArchiveTraining] = useState(true);
  const [archiveNutrition, setArchiveNutrition] = useState(true);
  const [archiveHabits, setArchiveHabits] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>(
    phase.milestones ?? []
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, isLoading } = useSWR<{
    success: boolean;
    data: PhaseReviewData;
  }>(
    open
      ? `/api/clients/${clientId}/roadmap/phases/${phase.id}/transition`
      : null,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  const reviewData = data?.data;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/roadmap/phases/${phase.id}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coachReflection: reflection || undefined,
            nextAction,
            planHandling: {
              trainingPlan: archiveTraining ? "archive" : "keep",
              nutritionPlan: archiveNutrition ? "archive" : "keep",
              habits: archiveHabits ? "archive" : "keep",
            },
            milestones: milestones.length > 0 ? milestones : undefined,
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to complete phase");
      }

      toast({ title: `"${phase.name}" completed` });
      // Archiving the nutrition plan deletes its future nutrition_events;
      // refresh the calendar cache (cheap no-op when nothing was archived).
      void invalidateNutritionCalendar(clientId);
      onTransitionComplete();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to complete phase",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!inset-y-auto !h-auto !right-4 !top-4 !bottom-4 max-h-[calc(100vh-2rem)] w-[420px] rounded-lg border border-[rgba(13,148,136,0.08)] shadow-md p-5 flex flex-col bg-white"
      >
        <SheetHeader className="pb-3 border-b border-[rgba(13,148,136,0.08)] px-0">
          <SheetTitle className="text-lg font-semibold text-[#0c1a1e]">
            Complete Phase
          </SheetTitle>
          <SheetDescription className="text-[13px] text-[#93b0b4]">
            Review progress for &quot;{phase.name}&quot; before transitioning
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto pt-4 space-y-5 px-0.5">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <>
              {reviewData && (
                <PhaseReviewStats data={reviewData} weightUnit={weightUnit} />
              )}

              <PhaseReviewMilestones
                milestones={milestones}
                onChange={setMilestones}
              />

              {/* Coach reflection */}
              <div className="space-y-2">
                <span className={LABEL_CLASS}>
                  Coach Reflection
                </span>
                <Textarea
                  id="reflection"
                  placeholder="What went well? What should this client focus on next?"
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  rows={3}
                  className="border-[rgba(13,148,136,0.08)] focus-visible:ring-[#0d9488] text-[13px] text-[#0c1a1e] placeholder:text-[#93b0b4]"
                />
              </div>

              {/* Next action */}
              <div className="space-y-2">
                <span className={LABEL_CLASS}>
                  Next Step
                </span>
                <RadioGroup
                  value={nextAction}
                  onValueChange={(v) =>
                    setNextAction(v as "activate_next" | "archive_roadmap")
                  }
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="activate_next"
                      id="activate_next"
                      disabled={!reviewData?.hasNextPhase}
                    />
                    <Label
                      htmlFor="activate_next"
                      className={`text-[13px] ${
                        !reviewData?.hasNextPhase
                          ? "text-[#93b0b4]"
                          : "text-[#0c1a1e]"
                      }`}
                    >
                      Activate next phase
                      {reviewData?.nextPhaseName &&
                        ` ("${reviewData.nextPhaseName}")`}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="archive_roadmap"
                      id="archive_roadmap"
                    />
                    <Label
                      htmlFor="archive_roadmap"
                      className="text-[13px] text-[#0c1a1e]"
                    >
                      Archive roadmap
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Plan handling */}
              <div className="space-y-3">
                <span className={LABEL_CLASS}>
                  Plan Handling
                </span>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#0c1a1e]">
                      Archive training plan
                    </span>
                    <Switch
                      checked={archiveTraining}
                      onCheckedChange={setArchiveTraining}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#0c1a1e]">
                      Archive nutrition plan
                    </span>
                    <Switch
                      checked={archiveNutrition}
                      onCheckedChange={setArchiveNutrition}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#0c1a1e]">
                      Deactivate habits
                    </span>
                    <Switch
                      checked={archiveHabits}
                      onCheckedChange={setArchiveHabits}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-[rgba(13,148,136,0.08)] flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-[#0d9488] hover:bg-[#0d9488]/90 text-white"
            onClick={handleSubmit}
            disabled={isSubmitting || isLoading}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Complete Phase"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
