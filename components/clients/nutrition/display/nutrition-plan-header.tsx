"use client";

import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { format } from "date-fns";
import type { Phase } from "@/types/roadmap";

type NutritionPlanHeaderProps = {
  weeklyTotal: number;
  activePhase: Phase | null;
  onRegenerate?: () => void;
};

export function NutritionPlanHeader({
  weeklyTotal,
  activePhase,
  onRegenerate,
}: NutritionPlanHeaderProps) {
  const phaseDateRange = activePhase
    ? [
        activePhase.startDate ? format(new Date(activePhase.startDate), "MMM d") : null,
        activePhase.endDate ? format(new Date(activePhase.endDate), "MMM d") : null,
      ]
        .filter(Boolean)
        .join(" - ")
    : null;

  return (
    <div className="space-y-3">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-foreground">Nutrition Targets</h3>
        <div className="flex items-center gap-3">
          {onRegenerate && (
            <Button
              size="sm"
              onClick={onRegenerate}
              className="bg-primary hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Regenerate Plan
            </Button>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-success/10 text-success">
            Plan active
          </span>
        </div>
      </div>

      {/* Phase pill */}
      {activePhase && (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {activePhase.name}
          {phaseDateRange && ` (${phaseDateRange})`}
        </span>
      )}
    </div>
  );
}
