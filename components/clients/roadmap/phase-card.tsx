"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PhaseReviewDrawer } from "./phase-review-drawer";
import type { Phase, PhaseStatus } from "@/types/roadmap";

const statusBadgeVariant: Record<
  PhaseStatus,
  "secondary" | "default" | "success" | "neutral"
> = {
  planned: "secondary",
  active: "default",
  completed: "success",
  skipped: "neutral",
};

type PhaseCardProps = {
  phase: Phase;
  clientId: string;
  hasActivePhase: boolean;
  onUpdate: () => void;
};

export const PhaseCard = ({
  phase,
  clientId,
  hasActivePhase,
  onUpdate,
}: PhaseCardProps) => {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/roadmap/phases/${phase.id}/activate`,
        { method: "POST" }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to activate phase");
      }

      toast({ title: `"${phase.name}" activated` });
      onUpdate();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to activate phase",
        variant: "destructive",
      });
    } finally {
      setIsActivating(false);
    }
  };

  const showActivate = phase.status === "planned";
  const activateDisabled = hasActivePhase || isActivating;

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-sm font-medium hover:underline"
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                )}
                {phase.name}
              </button>
              <Badge variant={statusBadgeVariant[phase.status]}>
                {phase.status}
              </Badge>
            </div>

            {(phase.startDate || phase.endDate) && (
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>
                  {phase.startDate && phase.startDate}
                  {phase.startDate && phase.endDate && " → "}
                  {phase.endDate && phase.endDate}
                </span>
              </div>
            )}
          </div>

          {showActivate && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleActivate}
              disabled={activateDisabled}
              title={
                hasActivePhase
                  ? "Complete the current active phase first"
                  : "Activate this phase"
              }
            >
              {isActivating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Activate"
              )}
            </Button>
          )}

          {phase.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewOpen(true)}
            >
              Complete Phase
            </Button>
          )}
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-2">
            {phase.description && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Description
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {phase.description}
                </p>
              </div>
            )}
            {phase.objectives && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Objectives
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {phase.objectives}
                </p>
              </div>
            )}
            {phase.durationWeeks && (
              <p className="text-xs text-muted-foreground">
                Duration: {phase.durationWeeks} week
                {phase.durationWeeks !== 1 ? "s" : ""}
              </p>
            )}
            {!phase.description && !phase.objectives && !phase.durationWeeks && (
              <p className="text-sm text-muted-foreground">
                No additional details.
              </p>
            )}
          </div>
        )}
      </CardContent>

      <PhaseReviewDrawer
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        phase={phase}
        clientId={clientId}
        onTransitionComplete={onUpdate}
      />
    </Card>
  );
};
