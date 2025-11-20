"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import type { GoalProgress } from "@/types/check-in";

type BodyFatGoalCardProps = {
  bodyFatGoal: NonNullable<GoalProgress["bodyFat"]>;
};

export const BodyFatGoalCard = ({ bodyFatGoal }: BodyFatGoalCardProps) => {
  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold flex items-center gap-2 mb-1">
              <span className="text-purple-600 dark:text-purple-400">📈</span>
              Body Fat Goal
            </h4>
            <div className="flex items-center gap-2">
              {bodyFatGoal.isOnTrack ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              )}
              <span
                className={`text-xs font-medium ${
                  bodyFatGoal.isOnTrack
                    ? "text-green-600 dark:text-green-400"
                    : "text-yellow-600 dark:text-yellow-400"
                }`}
              >
                {bodyFatGoal.isOnTrack ? "On Track" : "Needs Attention"}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">
              {Math.round(bodyFatGoal.percentComplete)}%
            </div>
            <div className="text-xs text-muted-foreground">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={bodyFatGoal.percentComplete} className="h-3" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Start: {bodyFatGoal.startingBodyFat}%</span>
            <span>Goal: {bodyFatGoal.goal}%</span>
          </div>
        </div>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Current Body Fat
            </div>
            <div className="text-lg font-semibold">{bodyFatGoal.current}%</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Remaining</div>
            <div className="text-lg font-semibold">
              {Math.abs(bodyFatGoal.remaining)}%
            </div>
          </div>
        </div>

        {/* Average Change */}
        {bodyFatGoal.avgChange !== undefined && (
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground mb-1">
              Average Change Per Check-In
            </div>
            <div className="flex items-center gap-2">
              {bodyFatGoal.avgChange < 0 ? (
                <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingUp className="h-4 w-4 text-red-600 dark:text-red-400" />
              )}
              <span className="font-medium">
                {Math.abs(bodyFatGoal.avgChange).toFixed(1)}% per check-in
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
