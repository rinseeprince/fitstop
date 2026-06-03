"use client";

import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, TrendingDown, TrendingUp, Percent } from "lucide-react";
import type { GoalProgress } from "@/types/check-in";

type BodyFatGoalCardProps = {
  bodyFatGoal: NonNullable<GoalProgress["bodyFat"]>;
};

export const BodyFatGoalCard = ({ bodyFatGoal }: BodyFatGoalCardProps) => {
  const onTrack = bodyFatGoal.isOnTrack;
  const badgeCls = onTrack ? "text-[#0d9488]" : "text-[#d97706]";

  return (
    <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold flex items-center gap-2 mb-1 text-[#0c1a1e]">
              <Percent className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              Body Fat Goal
            </h4>
            <div className="flex items-center gap-2">
              {onTrack ? (
                <CheckCircle2 className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              ) : (
                <AlertCircle className="h-4 w-4 text-[#d97706]" strokeWidth={1.5} />
              )}
              <span className={`text-xs font-medium ${badgeCls}`}>
                {onTrack ? "On track" : "Needs attention"}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold font-mono-display text-[#0d9488]">
              {Math.round(bodyFatGoal.percentComplete)}%
            </div>
            <div className="text-xs text-[#93b0b4]">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={bodyFatGoal.percentComplete} className="h-3" />
          <div className="flex justify-between text-xs text-[#93b0b4] font-mono-display">
            <span>Start: {bodyFatGoal.startingBodyFat}%</span>
            <span>Goal: {bodyFatGoal.goal}%</span>
          </div>
        </div>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[rgba(13,148,136,0.08)]">
          <div>
            <div className="text-xs text-[#93b0b4] mb-1">Current Body Fat</div>
            <div className="text-lg font-semibold font-mono-display text-[#0c1a1e]">{bodyFatGoal.current}%</div>
          </div>
          <div>
            <div className="text-xs text-[#93b0b4] mb-1">Remaining</div>
            <div className="text-lg font-semibold font-mono-display text-[#0c1a1e]">
              {Math.abs(bodyFatGoal.remaining)}%
            </div>
          </div>
        </div>

        {/* Average Change */}
        {bodyFatGoal.avgChange !== undefined && (
          <div className="pt-2 border-t border-[rgba(13,148,136,0.08)]">
            <div className="text-xs text-[#93b0b4] mb-1">Average Change Per Check-In</div>
            <div className="flex items-center gap-2">
              {bodyFatGoal.avgChange < 0 ? (
                <TrendingDown className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              ) : (
                <TrendingUp className="h-4 w-4 text-[#d97706]" strokeWidth={1.5} />
              )}
              <span className="font-medium font-mono-display text-[#0c1a1e]">
                {Math.abs(bodyFatGoal.avgChange).toFixed(1)}% per check-in
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
