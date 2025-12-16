"use client";

import type { TrainingPlan } from "@/types/training";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings2, Shuffle, Loader2 } from "lucide-react";
import { format } from "date-fns";

type PlanDisplayHeaderProps = {
  plan: TrainingPlan;
  editMode: boolean;
  onToggleEdit: () => void;
  onRefreshExercises: () => void;
  isRefreshing?: boolean;
};

const SPLIT_TYPE_LABELS: Record<string, string> = {
  push_pull_legs: "Push/Pull/Legs",
  upper_lower: "Upper/Lower",
  full_body: "Full Body",
  bro_split: "Bro Split",
  push_pull: "Push/Pull",
  custom: "Custom",
};

export function PlanDisplayHeader({
  plan,
  editMode,
  onToggleEdit,
  onRefreshExercises,
  isRefreshing,
}: PlanDisplayHeaderProps) {
  const splitLabel = SPLIT_TYPE_LABELS[plan.splitType] || plan.splitType;

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">{plan.name}</h3>
          {plan.description && (
            <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="secondary">{splitLabel}</Badge>
            <Badge variant="secondary">{plan.frequencyPerWeek}x/week</Badge>
            {plan.programDurationWeeks && (
              <Badge variant="secondary">{plan.programDurationWeeks} weeks</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onToggleEdit}>
            <Settings2 className="h-4 w-4 mr-1" />
            {editMode ? "Done" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshExercises}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Shuffle className="h-4 w-4 mr-1" />
            )}
            {isRefreshing ? "Refreshing..." : "New Exercises"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Created on {format(new Date(plan.createdAt), "MMM d, yyyy")}
      </p>
    </div>
  );
}
