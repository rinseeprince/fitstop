"use client";

import type { TrainingPlan } from "@/types/training";
import { Button } from "@/components/ui/button";
import { Settings2, Shuffle, Loader2, History, Sparkles } from "lucide-react";
import { format } from "date-fns";

type PlanDisplayHeaderProps = {
  plan: TrainingPlan;
  editMode: boolean;
  onToggleEdit: () => void;
  onRefreshExercises: () => void;
  isRefreshing?: boolean;
  onShowHistory?: () => void;
  onRegenerate?: () => void;
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
  onShowHistory,
  onRegenerate,
}: PlanDisplayHeaderProps) {
  const splitLabel = SPLIT_TYPE_LABELS[plan.splitType] || plan.splitType;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          {/* Section title - Section 3.3 */}
          <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
          {plan.description && (
            <p className="text-sm text-gray-500 mt-1.5">{plan.description}</p>
          )}
          {/* Badges - Section 8.3 */}
          <div className="flex flex-wrap gap-2 mt-4">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">
              {splitLabel}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">
              {plan.frequencyPerWeek}x/week
            </span>
            {plan.programDurationWeeks && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                {plan.programDurationWeeks} weeks
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRegenerate && (
            <Button
              size="sm"
              onClick={onRegenerate}
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Regenerate Plan
            </Button>
          )}
          {onShowHistory && (
            <Button variant="ghost" size="sm" onClick={onShowHistory}>
              <History className="h-4 w-4 mr-1.5" />
              History
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onToggleEdit}>
            <Settings2 className="h-4 w-4 mr-1.5" />
            {editMode ? "Done" : "Edit"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefreshExercises}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Shuffle className="h-4 w-4 mr-1.5" />
            )}
            {isRefreshing ? "Refreshing..." : "New Exercises"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-gray-400 mt-4">
        Created on {format(new Date(plan.createdAt), "MMM d, yyyy")}
      </p>
    </div>
  );
}
