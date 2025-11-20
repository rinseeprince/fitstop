"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { GoalProgress } from "@/types/check-in";

type WeightGoalCardProps = {
  weightGoal: NonNullable<GoalProgress["weight"]>;
};

export const WeightGoalCard = ({ weightGoal }: WeightGoalCardProps) => {
  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold flex items-center gap-2 mb-1">
              <span className="text-blue-600 dark:text-blue-400">⚖️</span>
              Weight Goal
            </h4>
            <div className="flex items-center gap-2">
              {weightGoal.isOnTrack ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              )}
              <span
                className={`text-xs font-medium ${
                  weightGoal.isOnTrack
                    ? "text-green-600 dark:text-green-400"
                    : "text-yellow-600 dark:text-yellow-400"
                }`}
              >
                {weightGoal.isOnTrack ? "On Track" : "Needs Attention"}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">
              {Math.round(weightGoal.percentComplete)}%
            </div>
            <div className="text-xs text-muted-foreground">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={weightGoal.percentComplete} className="h-3" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Start: {weightGoal.startingWeight}
              {weightGoal.unit}
            </span>
            <span>
              Goal: {weightGoal.goal}
              {weightGoal.unit}
            </span>
          </div>
        </div>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Current Weight</div>
            <div className="text-lg font-semibold">
              {weightGoal.current}
              {weightGoal.unit}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Remaining</div>
            <div className="text-lg font-semibold">
              {Math.abs(weightGoal.remaining)}
              {weightGoal.unit}
            </div>
          </div>
        </div>

        {/* Rate of Progress */}
        {weightGoal.avgWeeklyChange !== undefined && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Average Weekly Change
                </div>
                <div className="flex items-center gap-2">
                  {weightGoal.avgWeeklyChange < 0 ? (
                    <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <TrendingUp className="h-4 w-4 text-red-600 dark:text-red-400" />
                  )}
                  <span className="font-medium">
                    {Math.abs(weightGoal.avgWeeklyChange)}
                    {weightGoal.unit}/week
                  </span>
                </div>
              </div>
              {weightGoal.weeksToGoal !== undefined && (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground mb-1">
                    Estimated Time
                  </div>
                  <div className="font-medium">
                    {Math.round(weightGoal.weeksToGoal)} weeks
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Projected Completion */}
        {weightGoal.projectedCompletionDate && (
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground mb-1">
              Projected Goal Date
            </div>
            <div className="font-medium">
              {format(new Date(weightGoal.projectedCompletionDate), "MMMM d, yyyy")}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              (
              {formatDistanceToNow(new Date(weightGoal.projectedCompletionDate), {
                addSuffix: true,
              })}
              )
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
